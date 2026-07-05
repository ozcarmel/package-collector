import type { DeliveryPackage } from "@/lib/types";

export const deliveredHomeGracePeriodMs = 10 * 60 * 1000;

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
