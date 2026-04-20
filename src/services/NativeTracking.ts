import {
  NeuromorphicAssetEngagement,
  NeuromorphicInsertion,
  TwinAudienceSession
} from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface TrackingSummary {
  engagementByAsset: NeuromorphicAssetEngagement[];
  estimatedNativeEngagementSeconds: number;
  highIntentUsers: number;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export class NativeTracking {
  compute(
    insertions: NeuromorphicInsertion[],
    sessions: TwinAudienceSession[]
  ): TrackingSummary {
    if (insertions.length === 0 || sessions.length === 0) {
      return {
        engagementByAsset: [],
        estimatedNativeEngagementSeconds: 0,
        highIntentUsers: 0
      };
    }

    const insertionByFrame = new Map<string, NeuromorphicInsertion[]>();
    for (const insertion of insertions) {
      const frameInsertions = insertionByFrame.get(insertion.frameId) ?? [];
      frameInsertions.push(insertion);
      insertionByFrame.set(insertion.frameId, frameInsertions);
    }

    const focusedMsByAsset = new Map<string, number>();
    const weightedSecondsByAsset = new Map<string, number>();
    const usersByAsset = new Map<string, Set<string>>();
    let highIntentUsers = 0;

    for (const session of sessions) {
      let weightedSessionSeconds = 0;
      const events = [...session.focusEvents].sort((a, b) => a.timestampMs - b.timestampMs);

      for (let index = 0; index < events.length; index += 1) {
        const event = events[index]!;

        const currentInsertions = insertionByFrame.get(event.frameId);
        if (!currentInsertions || currentInsertions.length === 0) {
          continue;
        }

        const nextEvent = events[index + 1];
        const durationMs = clamp(
          (nextEvent?.timestampMs ?? event.timestampMs + 1000) - event.timestampMs,
          50,
          4000
        );

        for (const insertion of currentInsertions) {
          const focusRadius = 60 + insertion.transform.scale * 40;
          const near = distance(event.x, event.y, insertion.transform.x, insertion.transform.y) <= focusRadius;
          if (!near) {
            continue;
          }

          const gazeWeight = clamp(event.gazeIntensity, 0, 1);
          const weightedMs = durationMs * gazeWeight * clamp(insertion.invisibilityScore + 0.2, 0.2, 1.2);
          focusedMsByAsset.set(insertion.assetId, (focusedMsByAsset.get(insertion.assetId) ?? 0) + durationMs);
          weightedSecondsByAsset.set(insertion.assetId, (weightedSecondsByAsset.get(insertion.assetId) ?? 0) + weightedMs / 1000);
          weightedSessionSeconds += weightedMs / 1000;

          const users = usersByAsset.get(insertion.assetId) ?? new Set<string>();
          users.add(session.userId);
          usersByAsset.set(insertion.assetId, users);
        }
      }

      if (weightedSessionSeconds >= 2.5) {
        highIntentUsers += 1;
      }
    }

    const assetIds = Array.from(new Set(insertions.map((item) => item.assetId)));
    const engagementByAsset = assetIds.map((assetId) => ({
      assetId,
      focusedMilliseconds: Math.round(focusedMsByAsset.get(assetId) ?? 0),
      weightedAttentionSeconds: Number((weightedSecondsByAsset.get(assetId) ?? 0).toFixed(3)),
      engagedUsers: usersByAsset.get(assetId)?.size ?? 0
    }));
    const estimatedNativeEngagementSeconds = Number(
      engagementByAsset
        .reduce((sum, asset) => sum + asset.weightedAttentionSeconds, 0)
        .toFixed(3)
    );

    return {
      engagementByAsset,
      estimatedNativeEngagementSeconds,
      highIntentUsers
    };
  }
}
