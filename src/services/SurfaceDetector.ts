import {
  NeuromorphicDetectedSurface,
  SurfaceCandidateInput,
  TwinFrameInput
} from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return clamp(value / max, 0, 1);
}

function buildPlane(candidate: SurfaceCandidateInput, frame: TwinFrameInput): NeuromorphicDetectedSurface["plane"] {
  const cx = candidate.x + candidate.width / 2;
  const cy = candidate.y + candidate.height / 2;
  const nx = clamp((cx / frame.width - 0.5) * 0.3, -0.15, 0.15);
  const ny = clamp((cy / frame.height - 0.5) * 0.3, -0.15, 0.15);
  const nz = Math.sqrt(Math.max(0.01, 1 - nx * nx - ny * ny));

  return {
    nx,
    ny,
    nz,
    depth: candidate.depth
  };
}

function mapTemperatureKelvin(luma: number): number {
  const normalized = clamp(luma, 0, 1);
  return Math.round(4600 + normalized * 2200);
}

export class SurfaceDetector {
  detectSurfaces(frames: TwinFrameInput[]): NeuromorphicDetectedSurface[] {
    return frames.flatMap((frame) => {
      return frame.candidates.map((candidate, index) => {
        const area = candidate.width * candidate.height;
        const frameArea = Math.max(frame.width * frame.height, 1);
        const areaRatio = normalize(area, frameArea);
        const lumaBalance = 1 - Math.abs(clamp(candidate.luma, 0, 1) - 0.55);
        const occlusionPenalty = clamp(candidate.occlusion, 0, 1);
        const confidence = clamp(
          0.35 + areaRatio * 0.4 + lumaBalance * 0.35 - occlusionPenalty * 0.4,
          0.05,
          0.98
        );

        return {
          surfaceId: `${frame.frameId}-${candidate.kind}-${index}`,
          frameId: frame.frameId,
          kind: candidate.kind,
          plane: buildPlane(candidate, frame),
          bbox: {
            x: candidate.x,
            y: candidate.y,
            width: candidate.width,
            height: candidate.height
          },
          lighting: {
            luma: clamp(candidate.luma, 0, 1),
            temperatureKelvin: mapTemperatureKelvin(candidate.luma)
          },
          occlusionMap: {
            blockedRatio: occlusionPenalty,
            confidence: clamp(1 - occlusionPenalty * 0.7, 0, 1)
          },
          confidence
        };
      });
    });
  }
}
