import type { DeliveryPackage } from "@/lib/types";

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

function israelCalendarDay(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? [year, month, day].join("-") : null;
}

export function isCollectedPackageExpired(
  pkg: Pick<DeliveryPackage, "status" | "updatedAt" | "collectedAt" | "deliveredAt">,
  now = new Date(),
) {
  const expiresAtMidnight =
    pkg.status === "collected" ||
    pkg.status === "arrived" ||
    pkg.status === "ready_for_handoff" ||
    pkg.status === "delivered";
  if (!expiresAtMidnight) return false;

  const statusTimestamp =
    pkg.status === "collected"
      ? pkg.collectedAt ?? pkg.updatedAt
      : pkg.status === "delivered"
        ? pkg.deliveredAt ?? pkg.updatedAt
        : pkg.updatedAt;
  const statusDay = israelCalendarDay(statusTimestamp);
  const currentDay = israelCalendarDay(now);
  if (!statusDay || !currentDay) return false;

  return statusDay < currentDay;
}
