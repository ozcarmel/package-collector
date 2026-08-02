import type { DeliveryPackage } from "@/lib/types";

type UserIdMatcher = string | Iterable<string>;

function toUserIdSet(userIds: UserIdMatcher) {
  return typeof userIds === "string" ? new Set([userIds]) : new Set(userIds);
}

export function getUserAddedPackages(packages: DeliveryPackage[], currentUserIds: UserIdMatcher) {
  const ownerUserIds = toUserIdSet(currentUserIds);

  return [...packages]
    .filter((pkg) => ownerUserIds.has(pkg.ownerUserId))
    .sort((a, b) =>
      (b.createdAt ?? b.updatedAt ?? "").localeCompare(a.createdAt ?? a.updatedAt ?? ""),
    );
}
