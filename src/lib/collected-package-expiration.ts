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
  pkg: Pick<DeliveryPackage, "status" | "updatedAt">,
  now = new Date(),
) {
  if (pkg.status !== "collected") return false;

  const collectedDay = israelCalendarDay(pkg.updatedAt);
  const currentDay = israelCalendarDay(now);
  if (!collectedDay || !currentDay) return false;

  return collectedDay < currentDay;
}
