import test from "node:test";
import assert from "node:assert/strict";
import { SurfaceDetector } from "../src/services/SurfaceDetector";
import { ProductInsertion } from "../src/services/ProductInsertion";
import { NativeTracking } from "../src/services/NativeTracking";
import { NeuromorphicDetectedSurface, TwinFrameInput } from "../src/types";

test("SurfaceDetector handles tiny or dark surfaces with bounded confidence", () => {
  const detector = new SurfaceDetector();
  const frames: TwinFrameInput[] = [
    {
      frameId: "f-edge",
      timestampMs: 1,
      width: 1,
      height: 1,
      candidates: [
        {
          kind: "table",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          depth: 0,
          luma: 0,
          occlusion: 1
        }
      ]
    }
  ];

  const surfaces = detector.detectSurfaces(frames);
  assert.equal(surfaces.length, 1);
  assert.ok(surfaces[0].confidence >= 0.05 && surfaces[0].confidence <= 0.98);
  assert.ok(Number.isFinite(surfaces[0].plane.nz));
  assert.ok(surfaces[0].lighting.temperatureKelvin >= 4600);
});

test("ProductInsertion uses fallback surfaces when preferred surfaces are unavailable", () => {
  const insertion = new ProductInsertion();
  const surfaces: NeuromorphicDetectedSurface[] = [
    {
      surfaceId: "s-1",
      frameId: "f-1",
      kind: "wall",
      plane: { nx: 0, ny: 0, nz: 0.95, depth: 1 },
      bbox: { x: 100, y: 100, width: 200, height: 150 },
      lighting: { luma: 0.6, temperatureKelvin: 6000 },
      occlusionMap: { blockedRatio: 0.1, confidence: 0.9 },
      confidence: 0.8
    }
  ];

  const placed = insertion.placeAssets(surfaces, [
    {
      assetId: "asset-1",
      brandName: "Quantbrew",
      productName: "Cup",
      preferredSurface: "table",
      baseScale: 1
    }
  ]);

  assert.equal(placed.length, 1);
  assert.equal(placed[0].surfaceId, "s-1");
  assert.ok(placed[0].invisibilityScore > 0.5);
});

test("NativeTracking sorts out-of-order events and classifies high-intent users", () => {
  const tracking = new NativeTracking();
  const summary = tracking.compute(
    [{
      insertionId: "i-1",
      frameId: "f-1",
      surfaceId: "s-1",
      assetId: "asset-1",
      transform: { x: 200, y: 200, scale: 1, perspective: 0.1 },
      postProcessing: { grain: 0.1, motionBlur: 0.1, colorMatch: 0.9 },
      invisibilityScore: 0.9
    }],
    [{
      userId: "u-1",
      focusEvents: [
        { frameId: "f-1", timestampMs: 3000, x: 200, y: 200, gazeIntensity: 1 },
        { frameId: "f-1", timestampMs: 1000, x: 201, y: 201, gazeIntensity: 1 }
      ]
    }]
  );

  assert.equal(summary.engagementByAsset.length, 1);
  assert.ok(summary.engagementByAsset[0].weightedAttentionSeconds >= 2.5);
  assert.equal(summary.highIntentUsers, 1);
});
