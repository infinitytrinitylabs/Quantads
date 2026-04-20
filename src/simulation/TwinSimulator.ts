import { evaluateEncounter, resolveQuantchatBonus } from "../quantads-experience";
import {
  Coordinate,
  LocationEvent,
  TwinSimulationRequest,
  TwinSimulationResponse
} from "../types";

function toLocationEvent(userId: string, coordinate: Coordinate, occurredAt: string): LocationEvent {
  return {
    userId,
    coordinate,
    occurredAt,
    platform: "ios"
  };
}

export function simulateTwinAudience(request: TwinSimulationRequest): TwinSimulationResponse {
  const results = request.audience.map((member) => {
    let triggeredDistance: number | null = null;
    let notificationDeepLink: string | undefined;
    let quantchatBonusEligible = false;

    member.route.some((coordinate, index) => {
      // Create timestamp with proper second offset for each route point
      const baseTimestamp = Date.UTC(2026, 0, 1, 0, 0, 0);
      const occurredAt = new Date(baseTimestamp + index * 1000).toISOString();
      const encounter = evaluateEncounter(request.campaign, toLocationEvent(member.userId, coordinate, occurredAt));

      if (!encounter.triggered || !encounter.notification) {
        return false;
      }

      triggeredDistance = encounter.distanceMeters;
      notificationDeepLink = encounter.notification.deepLink;

      const notificationOpenedAt = new Date(Date.parse(occurredAt) + 5_000).toISOString();
      const quantchatOpenedAt =
        member.quantchatOpenDelaySeconds === undefined
          ? undefined
          : new Date(Date.parse(notificationOpenedAt) + member.quantchatOpenDelaySeconds * 1_000).toISOString();

      quantchatBonusEligible = resolveQuantchatBonus(
        request.campaign,
        notificationOpenedAt,
        quantchatOpenedAt
      ).eligible;

      return true;
    });

    return {
      userId: member.userId,
      triggered: triggeredDistance !== null,
      distanceMeters: triggeredDistance,
      notificationDeepLink,
      quantchatBonusEligible
    };
  });

  const triggeredUsers = results.filter((result) => result.triggered);
  const triggerDistanceTotal = triggeredUsers.reduce(
    (sum, result) => sum + (result.distanceMeters ?? 0),
    0
  );

  return {
    summary: {
      triggerCount: triggeredUsers.length,
      projectedNotificationOpens: triggeredUsers.length,
      projectedQuantchatBonusClaims: results.filter((result) => result.quantchatBonusEligible).length,
      averageTriggerDistanceMeters:
        triggeredUsers.length === 0 ? 0 : triggerDistanceTotal / triggeredUsers.length
    },
    users: results
  };
}
