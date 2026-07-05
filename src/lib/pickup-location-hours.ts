import type { PickupLocation, Weekday } from "@/lib/types";

export type PickupLocationOpenState = "open" | "closed" | "unknown";

const fallbackWeeklyHoursByLocationId: Record<string, PickupLocation["weeklyHours"]> = {
  "home-paami": {
    0: [{ open: "10:00", close: "19:00" }],
    1: [{ open: "10:00", close: "19:00" }],
    2: [{ open: "10:00", close: "19:00" }],
    3: [{ open: "10:00", close: "19:00" }],
    4: [{ open: "10:00", close: "19:00" }],
    5: [{ open: "09:00", close: "12:00" }],
  },
  "post-office": {
    0: [{ open: "13:00", close: "18:00" }],
    1: [{ open: "11:00", close: "15:00" }],
    2: [{ open: "11:00", close: "15:00" }],
    3: [{ open: "11:00", close: "15:00" }],
    4: [{ open: "13:00", close: "18:00" }],
    5: [],
  },
  pitzutz: {
    0: [{ open: "08:00", close: "00:00" }],
    1: [{ open: "08:00", close: "00:00" }],
    2: [{ open: "08:00", close: "00:00" }],
    3: [{ open: "08:00", close: "00:00" }],
    4: [{ open: "08:00", close: "00:00" }],
    5: [{ open: "09:00", close: "14:00" }],
  },
  eshkolot: {
    0: [{ open: "08:00", close: "13:00" }],
    1: [{ open: "08:00", close: "13:00" }],
    2: [{ open: "08:00", close: "13:00" }],
    3: [{ open: "08:00", close: "13:00" }],
    4: [{ open: "08:00", close: "13:00" }],
    5: [],
  },
  "deli-place": {
    0: [{ open: "08:30", close: "14:00" }],
    1: [{ open: "08:30", close: "14:00" }],
    2: [{ open: "08:30", close: "14:00" }],
    3: [{ open: "08:30", close: "14:00" }],
    4: [{ open: "08:30", close: "14:00" }],
    5: [{ open: "08:30", close: "14:00" }],
  },
  shoval: {
    0: [{ open: "08:00", close: "14:00" }],
    1: [],
    2: [{ open: "08:00", close: "14:00" }],
    3: [],
    4: [{ open: "08:00", close: "14:00" }],
    5: [],
  },
};

const demoOpenStateByLocationId: Record<string, PickupLocationOpenState> = {
  "home-paami": "open",
  "post-office": "open",
  pitzutz: "open",
  eshkolot: "closed",
  "deli-place": "open",
  shoval: "open",
};

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function getPickupLocationOpenState(
  location: Pick<PickupLocation, "id" | "weeklyHours">,
  now = new Date(),
): PickupLocationOpenState {
  if (!location.weeklyHours && demoOpenStateByLocationId[location.id]) {
    return demoOpenStateByLocationId[location.id];
  }

  const weeklyHours = location.weeklyHours ?? fallbackWeeklyHoursByLocationId[location.id];
  if (!weeklyHours) return "unknown";

  const weekday = now.getDay() as Weekday;
  const windows = weeklyHours[weekday] ?? [];
  if (windows.length === 0) return "closed";

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isOpen = windows.some((window) => {
    const open = timeToMinutes(window.open);
    const close = timeToMinutes(window.close);
    if (open === null || close === null) return false;

    const normalizedClose = close <= open ? close + 24 * 60 : close;
    return currentMinutes >= open && currentMinutes < normalizedClose;
  });

  return isOpen ? "open" : "closed";
}
