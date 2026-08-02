import { describe, expect, it } from "vitest";
import { getUserAddedPackages } from "@/lib/home-package-visibility";
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

  it("returns packages added by equivalent current-user records", () => {
    const packages = [
      makePackage("own-current", "u-current", "waiting", "2026-06-28T10:00:00.000Z"),
      makePackage("own-previous-session", "u-previous", "waiting", "2026-06-28T12:00:00.000Z", {
        createdAt: "2026-06-28T12:00:00.000Z",
      }),
      makePackage("other", "u-other", "waiting", "2026-06-28T13:00:00.000Z"),
    ];

    expect(
      getUserAddedPackages(packages, new Set(["u-current", "u-previous"])).map((pkg) => pkg.id),
    ).toEqual(["own-previous-session", "own-current"]);
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
      "delivered-new",
      "arrived-new",
      "delivered-old",
      "arrived-old",
    ]);
  });
});
