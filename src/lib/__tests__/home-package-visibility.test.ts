import { describe, expect, it } from "vitest";
import {
  deliveredHomeGracePeriodMs,
  shouldShowPackageOnHome,
} from "@/lib/home-package-visibility";

describe("home package visibility", () => {
  const deliveredAt = "2026-06-28T10:00:00.000Z";
  const deliveredAtMs = Date.parse(deliveredAt);

  it("keeps delivered packages visible for ten minutes after receipt confirmation", () => {
    expect(deliveredHomeGracePeriodMs).toBe(10 * 60 * 1000);
    expect(
      shouldShowPackageOnHome(
        { status: "delivered", deliveredAt },
        deliveredAtMs + deliveredHomeGracePeriodMs - 1,
      ),
    ).toBe(true);
  });

  it("hides delivered packages from home after the ten minute grace period", () => {
    expect(
      shouldShowPackageOnHome(
        { status: "delivered", deliveredAt },
        deliveredAtMs + deliveredHomeGracePeriodMs,
      ),
    ).toBe(false);
  });

  it("keeps non-delivered packages visible", () => {
    expect(
      shouldShowPackageOnHome(
        { status: "arrived", deliveredAt },
        deliveredAtMs + deliveredHomeGracePeriodMs,
      ),
    ).toBe(true);
  });
});
