import { describe, expect, it } from "vitest";
import {
  deliveredAdminRetentionMs,
  deliveredHomeGracePeriodMs,
  getUserAddedPackages,
  shouldShowPackageInAdminList,
  shouldShowPackageOnHome,
} from "@/lib/home-package-visibility";
import { sortHomePackagesByStatus } from "@/lib/home-package-sort";
import type { DeliveryPackage, PackageStatus } from "@/lib/types";

function makePackage(
  id: string,
  ownerUserId: string,
  status: PackageStatus,
  updatedAt: string,
  overrides: Partial<DeliveryPackage> = {},
): DeliveryPackage {
  return {
    id,
    ownerUserId,
    ownerName: `Owner ${id}`,
    pickupLocationId: "pitzutz",
    publicSummary: "Package summary",
    status,
    updatedAt,
    ...overrides,
  };
}

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

  it("keeps delivered packages visible in admin for three days", () => {
    expect(deliveredAdminRetentionMs).toBe(3 * 24 * 60 * 60 * 1000);
    expect(
      shouldShowPackageInAdminList(
        { status: "delivered", deliveredAt },
        deliveredAtMs + deliveredAdminRetentionMs - 1,
      ),
    ).toBe(true);
  });

  it("hides delivered packages from admin after three days", () => {
    expect(
      shouldShowPackageInAdminList(
        { status: "delivered", deliveredAt },
        deliveredAtMs + deliveredAdminRetentionMs,
      ),
    ).toBe(false);
  });

  it("keeps non-delivered packages visible in admin regardless of age", () => {
    expect(
      shouldShowPackageInAdminList(
        { status: "waiting", deliveredAt },
        deliveredAtMs + deliveredAdminRetentionMs,
      ),
    ).toBe(true);
  });

  it("returns only packages added by the current user, newest first", () => {
    const packages = [
      makePackage("own-old", "u-current", "waiting", "2026-06-28T09:00:00.000Z"),
      makePackage("other", "u-other", "waiting", "2026-06-28T12:00:00.000Z"),
      makePackage("own-new", "u-current", "arrived", "2026-06-28T11:00:00.000Z", {
        createdAt: "2026-06-28T11:00:00.000Z",
      }),
    ];

    expect(getUserAddedPackages(packages, "u-current").map((pkg) => pkg.id)).toEqual([
      "own-new",
      "own-old",
    ]);
  });

  it("sorts home packages by status and newest update inside each status", () => {
    const packages = [
      makePackage("delivered-old", "u-current", "delivered", "2026-06-28T09:00:00.000Z"),
      makePackage("arrived-new", "u-current", "arrived", "2026-06-28T13:00:00.000Z"),
      makePackage("waiting-old", "u-current", "waiting", "2026-06-28T10:00:00.000Z"),
      makePackage("collected", "u-current", "collected", "2026-06-28T12:00:00.000Z"),
      makePackage("delivered-new", "u-current", "delivered", "2026-06-28T14:00:00.000Z"),
      makePackage("waiting-new", "u-current", "waiting", "2026-06-28T11:00:00.000Z"),
      makePackage("arrived-old", "u-current", "arrived", "2026-06-28T08:00:00.000Z"),
    ];

    expect(sortHomePackagesByStatus(packages).map((pkg) => pkg.id)).toEqual([
      "waiting-new",
      "waiting-old",
      "collected",
      "arrived-new",
      "arrived-old",
      "delivered-new",
      "delivered-old",
    ]);
  });
});
