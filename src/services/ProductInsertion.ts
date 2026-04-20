import {
  NeuromorphicDetectedSurface,
  NeuromorphicInsertion,
  TwinBrandedAsset
} from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sortSurfaces(surfaces: NeuromorphicDetectedSurface[]): NeuromorphicDetectedSurface[] {
  return [...surfaces].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    return a.surfaceId.localeCompare(b.surfaceId);
  });
}

function buildPostProcessing(surface: NeuromorphicDetectedSurface): NeuromorphicInsertion["postProcessing"] {
  const lumaDistance = Math.abs(surface.lighting.luma - 0.5);
  const grain = clamp(0.08 + surface.occlusionMap.blockedRatio * 0.28 + lumaDistance * 0.15, 0.05, 0.45);
  const motionBlur = clamp(0.05 + (1 - surface.plane.nz) * 0.55, 0.05, 0.6);
  const colorMatch = clamp(0.65 + surface.confidence * 0.3 - lumaDistance * 0.2, 0.5, 0.98);
  return { grain, motionBlur, colorMatch };
}

function computeInvisibilityScore(
  surface: NeuromorphicDetectedSurface,
  postProcessing: NeuromorphicInsertion["postProcessing"]
): number {
  return clamp(
    0.45 +
      surface.confidence * 0.3 +
      postProcessing.colorMatch * 0.2 +
      (1 - surface.occlusionMap.blockedRatio) * 0.1 -
      postProcessing.motionBlur * 0.05,
    0,
    1
  );
}

export class ProductInsertion {
  placeAssets(
    surfaces: NeuromorphicDetectedSurface[],
    assets: TwinBrandedAsset[]
  ): NeuromorphicInsertion[] {
    if (surfaces.length === 0 || assets.length === 0) {
      return [];
    }

    const ranked = sortSurfaces(surfaces);
    const usedSurfaceIds = new Set<string>();

    return assets.flatMap((asset, assetIndex) => {
      const preferred = ranked.filter((surface) => (
        surface.kind === asset.preferredSurface &&
        surface.confidence >= 0.25 &&
        !usedSurfaceIds.has(surface.surfaceId)
      ));
      const fallback = ranked.filter((surface) => (
        surface.confidence >= 0.45 &&
        !usedSurfaceIds.has(surface.surfaceId)
      ));
      const target = preferred[0] ?? fallback[0];

      if (!target) {
        return [];
      }

      usedSurfaceIds.add(target.surfaceId);
      const postProcessing = buildPostProcessing(target);
      const invisibilityScore = computeInvisibilityScore(target, postProcessing);

      return [{
        insertionId: `${target.surfaceId}-${asset.assetId}-${assetIndex}`,
        frameId: target.frameId,
        surfaceId: target.surfaceId,
        assetId: asset.assetId,
        transform: {
          x: target.bbox.x + target.bbox.width / 2,
          y: target.bbox.y + target.bbox.height / 2,
          scale: clamp(asset.baseScale * (0.65 + target.plane.depth * 0.5), 0.35, 2.4),
          perspective: clamp(1 - target.plane.nz, 0, 1)
        },
        postProcessing,
        invisibilityScore
      }];
    });
  }
}
