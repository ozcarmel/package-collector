import { describe, expect, it } from "vitest";
import { buildAdminPickupConfirmations } from "@/lib/admin-pickup-confirmations";
import { initialAppState } from "@/lib/demo-data";
import type { AppState } from "@/lib/types";

function auditState(): AppState {
  return {
    ...initialAppState,
    pickupRuns: [
      {
        id: "run-old",
        collectorUserId: "u-admin",
        pickupLocationId: "pitzutz",
        status: "active",
        sensitiveDetailsAccessConfirmedAt: "2026-08-18T08:15:00.000Z",
        createdAt: "2026-08-18T08:15:00.000Z",
      },
      {
        id: "run-new",
        collectorUserId: "u-admin",
        pickupLocationId: "post-office",
        status: "active",
        sensitiveDetailsAccessConfirmedAt: "2026-08-18T09:48:00.000Z",
        createdAt: "2026-08-18T09:48:00.000Z",
      },
    ],
    pickupRunItems: [
      {
        id: "item-collected",
        pickupRunId: "run-new",
        packageId: "pkg-hila",
        itemStatus: "pending",
        ownerNameSnapshot: "הילה נבון",
        lastCollectedAt: "2026-08-18T09:50:00.000Z",
      },
      {
        id: "item-never-collected",
        pickupRunId: "run-old",
        packageId: "pkg-ayelet",
        itemStatus: "pending",
        ownerNameSnapshot: "איילת מדר",
      },
    ],
  };
}

describe("buildAdminPickupConfirmations", () => {
  it("lists confirmations newest first with location, user, and collected recipients", () => {
    const confirmations = buildAdminPickupConfirmations(auditState());

    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]).toMatchObject({
      id: "run-new",
      pickupLocationName: "דואר להבים",
      confirmedAt: "2026-08-18T09:48:00.000Z",
      userName: "עוז כרמל",
      collectedPackageCount: 1,
      collectedRecipientNames: ["הילה נבון"],
    });
    expect(confirmations[1]).toMatchObject({
      id: "run-old",
      collectedPackageCount: 0,
      collectedRecipientNames: [],
    });
  });

  it("keeps a collection in the audit after the package is unmarked", () => {
    const confirmations = buildAdminPickupConfirmations(auditState());

    expect(confirmations[0].collectedPackageCount).toBe(1);
    expect(confirmations[0].collectedRecipientNames).toEqual(["הילה נבון"]);
  });
});