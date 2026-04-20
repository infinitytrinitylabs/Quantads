import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { app } from "../src/server";
import { NeuromorphicTwinSimulationRequest } from "../src/types";

test("POST /api/v1/twin-sim supports neuromorphic surface, insertion, and engagement simulation", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a numeric listening port.");
    }

    const payload: NeuromorphicTwinSimulationRequest = {
      mode: "neuromorphic",
      campaign: {
        id: "cmp-neuro-001",
        title: "Invisible Coffee Embed"
      },
      frames: [
        {
          frameId: "f-1",
          timestampMs: 1000,
          width: 1920,
          height: 1080,
          candidates: [
            {
              kind: "table",
              x: 420,
              y: 610,
              width: 320,
              height: 150,
              depth: 0.9,
              luma: 0.52,
              occlusion: 0.1
            }
          ]
        },
        {
          frameId: "f-2",
          timestampMs: 1033,
          width: 1920,
          height: 1080,
          candidates: [
            {
              kind: "wall",
              x: 1200,
              y: 210,
              width: 420,
              height: 420,
              depth: 1.3,
              luma: 0.62,
              occlusion: 0.08
            }
          ]
        }
      ],
      assets: [
        {
          assetId: "asset-coffee-cup",
          brandName: "QuantBrew",
          productName: "Aurora Latte Cup",
          preferredSurface: "table",
          baseScale: 1
        },
        {
          assetId: "asset-neon-sign",
          brandName: "QuantBrew",
          productName: "Ambient Wall Logo",
          preferredSurface: "wall",
          baseScale: 1.3
        }
      ],
      sessions: [
        {
          userId: "twin-user-1",
          focusEvents: [
            { frameId: "f-1", timestampMs: 1000, x: 580, y: 680, gazeIntensity: 0.88 },
            { frameId: "f-2", timestampMs: 1800, x: 1410, y: 430, gazeIntensity: 0.74 },
            { frameId: "f-2", timestampMs: 2800, x: 1410, y: 430, gazeIntensity: 0.65 }
          ]
        }
      ]
    };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/twin-sim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      mode: string;
      summary: {
        analyzedFrames: number;
        detectedSurfaces: number;
        insertedAssets: number;
        estimatedNativeEngagementSeconds: number;
      };
      insertions: Array<{ assetId: string; invisibilityScore: number }>;
      engagementByAsset: Array<{ assetId: string; weightedAttentionSeconds: number }>;
    };

    assert.equal(body.mode, "neuromorphic");
    assert.equal(body.summary.analyzedFrames, 2);
    assert.equal(body.summary.detectedSurfaces, 2);
    assert.equal(body.summary.insertedAssets, 2);
    assert.equal(body.insertions.length, 2);
    assert.ok(body.insertions.every((item) => item.invisibilityScore > 0.5));
    assert.ok(body.summary.estimatedNativeEngagementSeconds > 0);
    assert.ok(body.engagementByAsset.some((item) => item.assetId === "asset-coffee-cup"));
  } finally {
    server.close();
  }
});
