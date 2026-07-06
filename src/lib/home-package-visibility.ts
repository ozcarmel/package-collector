import type { DeliveryPackage } from "@/lib/types";

export const deliveredHomeGracePeriodMs = 10 * 60 * 1000;
export const deliveredAdminRetentionMs = 3 * 24 * 60 * 60 * 1000;

export function shouldShowPackageOnHome(
  pkg: Pick<DeliveryPackage, "deliveredAt" | "status">,
  currentTimeMs: number | null,
) {
  if (pkg.status !== "delivered") return true;
  if (!pkg.deliveredAt || currentTimeMs === null) return true;

  const deliveredAtMs = Date.parse(pkg.deliveredAt);
  if (Number.isNaN(deliveredAtMs)) return true;

  return currentTimeMs - deliveredAtMs < deliveredHomeGracePeriodMs;
}

export function shouldShowPackageInAdminList(
  pkg: Pick<DeliveryPackage, "deliveredAt" | "status">,
  currentTimeMs: number | null,
) {
  if (pkg.status !== "delivered") return true;
  if (!pkg.deliveredAt || currentTimeMs === null) return true;

  const deliveredAtMs = Date.parse(pkg.deliveredAt);
  if (Number.isNaN(deliveredAtMs)) return true;

  return currentTimeMs - deliveredAtMs < deliveredAdminRetentionMs;
}

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
