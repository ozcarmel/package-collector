import type { AppState, PickupLocation, WeeklyOpeningHours } from "@/lib/types";

interface ScheduleDefault {
  openingHours: string;
  weeklyHours: WeeklyOpeningHours;
  shouldApply: (location: PickupLocation) => boolean;
}

const scheduleDefaults: Record<string, ScheduleDefault> = {
  "home-paami": {
    openingHours: "א'-ה' 10:00-19:00, ו' 09:00-12:00",
    weeklyHours: {
      0: [{ open: "10:00", close: "19:00" }],
      1: [{ open: "10:00", close: "19:00" }],
      2: [{ open: "10:00", close: "19:00" }],
      3: [{ open: "10:00", close: "19:00" }],
      4: [{ open: "10:00", close: "19:00" }],
      5: [{ open: "09:00", close: "12:00" }],
    },
    shouldApply: (location) =>
      !location.weeklyHours ||
      location.openingHours.includes("09:00-20:00") ||
      location.openingHours.includes("08:30-14:30") ||
      location.openingHours.includes("צריך לאמת"),
  },
  "post-office": {
    openingHours: "א', ה' 13:00-18:00, ב'-ד' 11:00-15:00, ו' סגור",
    weeklyHours: {
      0: [{ open: "13:00", close: "18:00" }],
      1: [{ open: "11:00", close: "15:00" }],
      2: [{ open: "11:00", close: "15:00" }],
      3: [{ open: "11:00", close: "15:00" }],
      4: [{ open: "13:00", close: "18:00" }],
      5: [],
    },
    shouldApply: (location) =>
      !location.weeklyHours ||
      location.openingHours.includes("צריך לאמת") ||
      !location.openingHours.includes("ה'") ||
      !location.openingHours.includes("ו'"),
  },
  eshkolot: {
    openingHours: "א'-ה' 08:00-13:00, ו' סגור",
    weeklyHours: {
      0: [{ open: "08:00", close: "13:00" }],
      1: [{ open: "08:00", close: "13:00" }],
      2: [{ open: "08:00", close: "13:00" }],
      3: [{ open: "08:00", close: "13:00" }],
      4: [{ open: "08:00", close: "13:00" }],
      5: [],
    },
    shouldApply: (location) => !location.weeklyHours?.[5] || !location.openingHours.includes("ו'"),
  },
  "deli-place": {
    openingHours: "א'-ה' 08:30-14:00, ו' 08:30-14:00",
    weeklyHours: {
      0: [{ open: "08:30", close: "14:00" }],
      1: [{ open: "08:30", close: "14:00" }],
      2: [{ open: "08:30", close: "14:00" }],
      3: [{ open: "08:30", close: "14:00" }],
      4: [{ open: "08:30", close: "14:00" }],
      5: [{ open: "08:30", close: "14:00" }],
    },
    shouldApply: (location) =>
      !location.weeklyHours ||
      location.openingHours.includes("16:00-20:00") ||
      location.openingHours.includes("07:30-15:00") ||
      location.openingHours.includes("צריך לאמת"),
  },
};

function normalizePickupLocationSchedule(location: PickupLocation): PickupLocation {
  const scheduleDefault = scheduleDefaults[location.id];
  if (!scheduleDefault || !scheduleDefault.shouldApply(location)) return location;

  return {
    ...location,
    openingHours: scheduleDefault.openingHours,
    weeklyHours: scheduleDefault.weeklyHours,
  };
}

export function normalizePickupLocationSchedules(state: AppState): AppState {
  return {
    ...state,
    pickupLocations: state.pickupLocations.map(normalizePickupLocationSchedule),
  };
}
