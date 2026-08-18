import type { AppState, PickupRunItem } from "@/lib/types";

export interface AdminPickupConfirmation {
  id: string;
  pickupLocationName: string;
  confirmedAt: string;
  userName: string;
  collectedPackageCount: number;
  collectedRecipientNames: string[];
}

function wasEverCollected(item: PickupRunItem) {
  return Boolean(item.lastCollectedAt || item.collectedAt);
}

export function buildAdminPickupConfirmations(state: AppState): AdminPickupConfirmation[] {
  const usersById = new Map(state.users.map((user) => [user.id, user]));
  const locationsById = new Map(
    state.pickupLocations.map((location) => [location.id, location]),
  );
  const packagesById = new Map(state.packages.map((pkg) => [pkg.id, pkg]));
  const itemsByRunId = new Map<string, PickupRunItem[]>();

  for (const item of state.pickupRunItems) {
    const runItems = itemsByRunId.get(item.pickupRunId) ?? [];
    runItems.push(item);
    itemsByRunId.set(item.pickupRunId, runItems);
  }

  return state.pickupRuns
    .map((run) => {
      const collectedItems = (itemsByRunId.get(run.id) ?? []).filter(wasEverCollected);
      const collectedRecipientNames = [
        ...new Set(
          collectedItems
            .map(
              (item) =>
                item.ownerNameSnapshot ?? packagesById.get(item.packageId)?.ownerName,
            )
            .filter((name): name is string => Boolean(name)),
        ),
      ];

      return {
        id: run.id,
        pickupLocationName:
          locationsById.get(run.pickupLocationId)?.name ?? "נקודת איסוף לא ידועה",
        confirmedAt: run.sensitiveDetailsAccessConfirmedAt ?? run.createdAt,
        userName: usersById.get(run.collectorUserId)?.fullName ?? "משתמש לא ידוע",
        collectedPackageCount: collectedItems.length,
        collectedRecipientNames,
      };
    })
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}