import { describe, expect, it } from "vitest";
import { isCollectedPackageExpired } from "@/lib/collected-package-expiration";

describe("collected package expiration", () => {
  it("keeps a collected package visible before midnight in Israel", () => {
    expect(
      isCollectedPackageExpired(
        { status: "collected", updatedAt: "2026-08-31T18:00:00.000Z" },
        new Date("2026-08-31T20:59:59.000Z"),
      ),
    ).toBe(false);
  });

  it("expires a collected package at the next Israeli midnight", () => {
    expect(
      isCollectedPackageExpired(
        { status: "collected", updatedAt: "2026-08-31T18:00:00.000Z" },
        new Date("2026-08-31T21:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("uses the collection timestamp even if the package was updated later", () => {
    const pkg = {
      status: "collected" as const,
      collectedAt: "2026-08-31T20:59:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    };

    expect(isCollectedPackageExpired(pkg, new Date("2026-08-31T21:00:00.000Z"))).toBe(true);
  });

  it("keeps a package delivered in the kibbutz visible before midnight in Israel", () => {
    expect(
      isCollectedPackageExpired(
        { status: "arrived", updatedAt: "2026-08-31T20:30:00.000Z" },
        new Date("2026-08-31T20:59:59.000Z"),
      ),
    ).toBe(false);
  });

  it("expires a package delivered in the kibbutz at the next Israeli midnight", () => {
    expect(
      isCollectedPackageExpired(
        { status: "arrived", updatedAt: "2026-08-31T20:30:00.000Z" },
        new Date("2026-08-31T21:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("uses the kibbutz-delivery update time instead of the earlier collection time", () => {
    const pkg = {
      status: "arrived" as const,
      collectedAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-31T20:30:00.000Z",
    };

    expect(isCollectedPackageExpired(pkg, new Date("2026-08-31T20:59:59.000Z"))).toBe(false);
    expect(isCollectedPackageExpired(pkg, new Date("2026-08-31T21:00:00.000Z"))).toBe(true);
  });

  it("does not expire packages in other statuses", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");

    expect(
      isCollectedPackageExpired(
        { status: "waiting", updatedAt: "2026-08-31T18:00:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});
