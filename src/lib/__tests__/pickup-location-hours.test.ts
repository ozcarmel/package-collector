import { describe, expect, it } from "vitest";
import { getPickupLocationOpenState } from "@/lib/pickup-location-hours";

describe("getPickupLocationOpenState", () => {
  it("uses demo state to mark Shoval open", () => {
    expect(
      getPickupLocationOpenState(
        { id: "shoval" },
        new Date("2026-06-29T10:00:00+03:00"),
      ),
    ).toBe("open");
  });

  it("uses demo state to mark Eshkolot closed", () => {
    expect(
      getPickupLocationOpenState(
        { id: "eshkolot" },
        new Date("2026-06-30T16:30:00+03:00"),
      ),
    ).toBe("closed");
  });

  it("marks Pitzutz open inside its evening window when real hours are supplied", () => {
    expect(
      getPickupLocationOpenState(
        {
          id: "pitzutz",
          weeklyHours: {
            1: [
              { open: "10:00", close: "14:00" },
              { open: "18:00", close: "21:00" },
            ],
          },
        },
        new Date("2026-06-29T19:00:00+03:00"),
      ),
    ).toBe("open");
  });

  it("marks Pitzutz closed between its split windows when real hours are supplied", () => {
    expect(
      getPickupLocationOpenState(
        {
          id: "pitzutz",
          weeklyHours: {
            1: [
              { open: "10:00", close: "14:00" },
              { open: "18:00", close: "21:00" },
            ],
          },
        },
        new Date("2026-06-29T15:00:00+03:00"),
      ),
    ).toBe("closed");
  });

  it("marks truly unconfigured locations as unknown", () => {
    expect(
      getPickupLocationOpenState(
        { id: "unknown-location" },
        new Date("2026-06-29T10:00:00+03:00"),
      ),
    ).toBe("unknown");
  });

  it("uses real weekly hours when supplied on the location", () => {
    expect(
      getPickupLocationOpenState(
        {
          id: "shoval",
          weeklyHours: {
            1: [],
          },
        },
        new Date("2026-06-29T10:00:00+03:00"),
      ),
    ).toBe("closed");
  });
});
