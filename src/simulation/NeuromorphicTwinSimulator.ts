import {
  NeuromorphicTwinSimulationRequest,
  NeuromorphicTwinSimulationResponse
} from "../types";
import { SurfaceDetector } from "../services/SurfaceDetector";
import { ProductInsertion } from "../services/ProductInsertion";
import { NativeTracking } from "../services/NativeTracking";

const detector = new SurfaceDetector();
const insertion = new ProductInsertion();
const tracking = new NativeTracking();

export function simulateNeuromorphicTwinAudience(
  request: NeuromorphicTwinSimulationRequest
): NeuromorphicTwinSimulationResponse {
  const surfaces = detector.detectSurfaces(request.frames);
  const insertions = insertion.placeAssets(surfaces, request.assets);
  const engagement = tracking.compute(insertions, request.sessions);
  const averageInvisibilityScore = insertions.length === 0
    ? 0
    : Number(
      (
        insertions.reduce((sum, item) => sum + item.invisibilityScore, 0) / insertions.length
      ).toFixed(4)
    );

  return {
    mode: "neuromorphic",
    campaignId: request.campaign.id,
    summary: {
      analyzedFrames: request.frames.length,
      detectedSurfaces: surfaces.length,
      insertedAssets: insertions.length,
      averageInvisibilityScore,
      estimatedNativeEngagementSeconds: engagement.estimatedNativeEngagementSeconds,
      highIntentUsers: engagement.highIntentUsers
    },
    surfaces,
    insertions,
    engagementByAsset: engagement.engagementByAsset
  };
}
