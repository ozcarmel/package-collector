import type { DeliveryPackage, PackageStatus } from "@/lib/types";

export function getHomePackageStatusSortRank(status: PackageStatus) {
  switch (status) {
    case "waiting":
    case "assigned":
      return 0;
    case "collected":
      return 1;
    case "arrived":
    case "ready_for_handoff":
      return 2;
    case "delivered":
      return 3;
    case "cancelled":
      return 4;
  }
}

function packageSortTimestamp(pkg: Pick<DeliveryPackage, "createdAt" | "updatedAt">) {
  const timestamp = Date.parse(pkg.updatedAt || pkg.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortHomePackagesByStatus<T extends DeliveryPackage>(packages: T[]) {
  return [...packages].sort((a, b) => {
    const statusDiff =
      getHomePackageStatusSortRank(a.status) - getHomePackageStatusSortRank(b.status);

    if (statusDiff !== 0) return statusDiff;

    const timeDiff = packageSortTimestamp(b) - packageSortTimestamp(a);

    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });
}
