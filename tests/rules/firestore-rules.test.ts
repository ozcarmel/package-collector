import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-lahav-packages-rules";
const now = "2026-06-30T10:00:00.000Z";

let testEnv: RulesTestEnvironment;

function userDoc(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    fullName: id,
    phone: "050-000-0000",
    role: "member",
    verificationStatus: "approved",
    createdAt: now,
    approvedAt: now,
    ...overrides,
  };
}

function packageDoc(
  id: string,
  ownerUserId: string,
  pickupLocationId = "pitzutz",
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    ownerUserId,
    ownerName: "Owner",
    pickupLocationId,
    publicSummary: "Waiting for pickup",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedDoc(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(path).set(data);
  });
}

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("firestore security rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: readFileSync(join(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("blocks pending users from creating packages or pickup runs", async () => {
    await seedDoc("users/u-pending", {
      id: "u-pending",
      fullName: "Pending User",
      phone: "050-000-0000",
      role: "member",
      verificationStatus: "admin_pending",
      createdAt: now,
    });
    const db = dbFor("u-pending");

    await assertFails(db.doc("packages/pkg-pending").set(packageDoc("pkg-pending", "u-pending")));
    await assertFails(
      db.doc("pickupRuns/run-pending").set({
        id: "run-pending",
        collectorUserId: "u-pending",
        pickupLocationId: "pitzutz",
        status: "active",
        createdAt: now,
      }),
    );
  });

  it("allows approved members to create their own public package document", async () => {
    await seedDoc("users/u-member", userDoc("u-member"));

    await assertSucceeds(
      dbFor("u-member").doc("packages/pkg-member").set(packageDoc("pkg-member", "u-member")),
    );
  });

  it("allows signed-in users to read user profiles for returning-phone lookup", async () => {
    await seedDoc("users/u-approved", userDoc("u-approved"));

    await assertSucceeds(dbFor("u-new-device").doc("users/u-approved").get());
  });

  it("allows a signed-in session to approve itself as a regular member only", async () => {
    await assertSucceeds(
      dbFor("u-new-device").doc("users/u-new-device").set({
        id: "u-new-device",
        fullName: "Returning User",
        phone: "050-111-1111",
        role: "member",
        verificationStatus: "approved",
        createdAt: now,
        approvedAt: now,
      }),
    );

    await seedDoc("users/u-pending-device", {
      id: "u-pending-device",
      fullName: "",
      phone: "",
      role: "member",
      verificationStatus: "phone_pending",
      createdAt: now,
    });
    await assertSucceeds(
      dbFor("u-pending-device").doc("users/u-pending-device").set(
        {
          id: "u-pending-device",
          fullName: "Returning User",
          phone: "050-111-1111",
          role: "member",
          verificationStatus: "approved",
          createdAt: now,
          approvedAt: now,
        },
        { merge: true },
      ),
    );

    await assertFails(
      dbFor("u-not-admin").doc("users/u-not-admin").set({
        id: "u-not-admin",
        fullName: "Not Admin",
        phone: "050-222-2222",
        role: "admin",
        verificationStatus: "approved",
        createdAt: now,
        approvedAt: now,
      }),
    );

    await seedDoc("users/u-blocked-device", {
      id: "u-blocked-device",
      fullName: "Blocked User",
      phone: "050-333-3333",
      role: "member",
      verificationStatus: "blocked",
      createdAt: now,
    });
    await assertFails(
      dbFor("u-blocked-device").doc("users/u-blocked-device").set(
        {
          id: "u-blocked-device",
          fullName: "Blocked User",
          phone: "050-333-3333",
          role: "member",
          verificationStatus: "approved",
          createdAt: now,
          approvedAt: now,
        },
        { merge: true },
      ),
    );
  });

  it("hides sensitive package details until a collector has an access grant", async () => {
    await seedDoc("users/u-owner", userDoc("u-owner"));
    await seedDoc("users/u-collector", userDoc("u-collector"));
    await seedDoc("packages/pkg-secure", packageDoc("pkg-secure", "u-owner"));
    await seedDoc("sensitivePackageDetails/pkg-secure", {
      packageId: "pkg-secure",
      ownerUserId: "u-owner",
      pickupLocationId: "pitzutz",
      sensitiveDeliveryMessage: "Original protected message",
      sensitivePickupLink: "https://example.com/pickup",
      createdAt: now,
      updatedAt: now,
    });

    const collectorDb = dbFor("u-collector");

    await assertFails(collectorDb.doc("sensitivePackageDetails/pkg-secure").get());

    await seedDoc("sensitiveAccessGrants/u-collector_pkg-secure", {
      id: "u-collector_pkg-secure",
      packageId: "pkg-secure",
      pickupRunId: "run-secure",
      viewerUserId: "u-collector",
      pickupLocationId: "pitzutz",
      createdAt: now,
    });

    await assertSucceeds(collectorDb.doc("sensitivePackageDetails/pkg-secure").get());
  });

  it("allows admins to approve or reject pending users and join requests", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    await seedDoc("users/u-pending", {
      id: "u-pending",
      fullName: "Pending User",
      phone: "050-111-1111",
      role: "member",
      verificationStatus: "admin_pending",
      createdAt: now,
    });
    await seedDoc("joinRequests/jr-pending", {
      id: "jr-pending",
      userId: "u-pending",
      fullName: "Pending User",
      phone: "050-111-1111",
      status: "pending",
      createdAt: now,
    });
    const adminDb = dbFor("u-admin");

    await assertSucceeds(
      adminDb.doc("users/u-pending").update({
        fullName: "Pending User",
        phone: "050-111-1111",
        role: "member",
        verificationStatus: "approved",
        createdAt: now,
        approvedAt: now,
        approvedByUserId: "u-admin",
      }),
    );
    await assertSucceeds(
      adminDb.doc("joinRequests/jr-pending").update({
        status: "rejected",
        reviewedAt: now,
        reviewedByUserId: "u-admin",
      }),
    );
  });

  it("allows admins to approve pending users and join requests in one batch", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    await seedDoc("users/u-pending", {
      id: "u-pending",
      fullName: "Pending User",
      phone: "050-111-1111",
      role: "member",
      verificationStatus: "admin_pending",
      createdAt: now,
    });
    await seedDoc("joinRequests/jr-pending", {
      id: "jr-pending",
      userId: "u-pending",
      fullName: "Pending User",
      phone: "050-111-1111",
      status: "pending",
      createdAt: now,
    });

    const adminDb = dbFor("u-admin");
    const batch = adminDb.batch();
    batch.update(adminDb.doc("joinRequests/jr-pending"), {
      status: "approved",
      reviewedAt: now,
      reviewedByUserId: "u-admin",
    });
    batch.set(adminDb.doc("users/u-pending"), {
      id: "u-pending",
      fullName: "Pending User",
      phone: "050-111-1111",
      role: "member",
      verificationStatus: "approved",
      createdAt: now,
      approvedAt: now,
      approvedByUserId: "u-admin",
    });

    await assertSucceeds(batch.commit());
  });

  it("allows admins to close stale pending join requests for already approved users", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    await seedDoc("users/u-approved", userDoc("u-approved"));
    await seedDoc("joinRequests/jr-stale", {
      id: "jr-stale",
      userId: "u-approved",
      fullName: "Already Approved",
      phone: "050-222-2222",
      status: "pending",
      createdAt: now,
    });

    await assertSucceeds(
      dbFor("u-admin").doc("joinRequests/jr-stale").update({
        status: "approved",
        reviewedAt: now,
        reviewedByUserId: "u-admin",
      }),
    );
  });

  it("prevents regular admins from promoting users or blocking managers", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    await seedDoc("users/u-member", userDoc("u-member"));
    await seedDoc("users/u-manager", userDoc("u-manager", { role: "admin" }));
    const adminDb = dbFor("u-admin");

    await assertFails(adminDb.doc("users/u-member").update({ role: "admin" }));
    await assertFails(
      adminDb.doc("users/u-manager").update({
        verificationStatus: "blocked",
        blockedAt: now,
        blockedByUserId: "u-admin",
      }),
    );
  });

  it("allows only Oz owner to promote members and block other managers", async () => {
    await seedDoc("users/u-oz", userDoc("u-oz", {
      fullName: "עוז כרמל",
      phone: "0584411883",
      role: "owner",
    }));
    await seedDoc("users/u-member", userDoc("u-member"));
    await seedDoc("users/u-manager", userDoc("u-manager", { role: "admin" }));
    await seedDoc("users/u-duplicate-oz", userDoc("u-duplicate-oz", {
      fullName: "עוז כרמל",
      phone: "0584411883",
      role: "owner",
    }));
    const ownerDb = dbFor("u-oz");

    await assertSucceeds(ownerDb.doc("users/u-member").update({ role: "admin" }));
    await assertSucceeds(
      ownerDb.doc("users/u-manager").update({
        verificationStatus: "blocked",
        blockedAt: now,
        blockedByUserId: "u-oz",
      }),
    );
    await assertFails(
      ownerDb.doc("users/u-duplicate-oz").update({
        verificationStatus: "blocked",
        blockedAt: now,
        blockedByUserId: "u-oz",
      }),
    );
    await assertFails(
      ownerDb.doc("users/u-oz").update({
        verificationStatus: "blocked",
        blockedAt: now,
        blockedByUserId: "u-oz",
      }),
    );
  });

  it("allows admins to manage pickup locations", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    const adminDb = dbFor("u-admin");

    await assertSucceeds(
      adminDb.doc("pickupLocations/new-location").set({
        id: "new-location",
        name: "New Location",
        address: "Lahav",
        openingHours: "Sun-Thu 08:00-13:00",
        weeklyHours: {
          0: [{ open: "08:00", close: "13:00" }],
        },
        navigationUrl: "https://example.com",
        activeRequests: 0,
      }),
    );
    await assertSucceeds(
      adminDb.doc("pickupLocations/new-location").update({
        openingHours: "Sun-Thu 08:00-14:00",
      }),
    );
  });

  it("allows package owners to mark arrived packages delivered", async () => {
    await seedDoc("users/u-owner", userDoc("u-owner"));
    await seedDoc(
      "packages/pkg-arrived",
      packageDoc("pkg-arrived", "u-owner", "pitzutz", {
        status: "arrived",
        currentKibbutzLocation: "gate-crate",
        currentKibbutzLocationText: "At the gate",
      }),
    );
    const ownerDb = dbFor("u-owner");

    await assertSucceeds(
      ownerDb.doc("packages/pkg-arrived").update({
        status: "delivered",
        deliveredAt: now,
        updatedAt: now,
      }),
    );
  });

  it("prevents non-owners from marking packages delivered", async () => {
    await seedDoc("users/u-owner", userDoc("u-owner"));
    await seedDoc("users/u-other", userDoc("u-other"));
    await seedDoc(
      "packages/pkg-arrived",
      packageDoc("pkg-arrived", "u-owner", "pitzutz", {
        status: "arrived",
      }),
    );

    await assertFails(
      dbFor("u-other").doc("packages/pkg-arrived").update({
        status: "delivered",
        deliveredAt: now,
        updatedAt: now,
      }),
    );
  });

  it("allows an approved same-phone session to update collected packages to arrived", async () => {
    await seedDoc("users/u-old-session", userDoc("u-old-session", { phone: "050-444-4444" }));
    await seedDoc("users/u-new-session", userDoc("u-new-session", { phone: "050-444-4444" }));
    await seedDoc(
      "packages/pkg-collected",
      packageDoc("pkg-collected", "u-owner", "pitzutz", {
        status: "collected",
        collectorUserId: "u-old-session",
      }),
    );

    await assertSucceeds(
      dbFor("u-new-session").doc("packages/pkg-collected").update({
        status: "arrived",
        currentKibbutzLocation: "kolbo",
        currentKibbutzLocationText: "At the kolbo",
        updatedAt: now,
      }),
    );
  });

  it("prevents a different phone session from updating another collector's package arrival", async () => {
    await seedDoc("users/u-old-session", userDoc("u-old-session", { phone: "050-444-4444" }));
    await seedDoc("users/u-different-phone", userDoc("u-different-phone", { phone: "050-555-5555" }));
    await seedDoc(
      "packages/pkg-collected",
      packageDoc("pkg-collected", "u-owner", "pitzutz", {
        status: "collected",
        collectorUserId: "u-old-session",
      }),
    );

    await assertFails(
      dbFor("u-different-phone").doc("packages/pkg-collected").update({
        status: "arrived",
        currentKibbutzLocation: "kolbo",
        currentKibbutzLocationText: "At the kolbo",
        updatedAt: now,
      }),
    );
  });

  it("allows admins to delete packages in any status", async () => {
    await seedDoc("users/u-admin", userDoc("u-admin", { role: "admin" }));
    await seedDoc(
      "packages/pkg-waiting",
      packageDoc("pkg-waiting", "u-owner", "pitzutz", { status: "waiting" }),
    );
    await seedDoc(
      "packages/pkg-arrived",
      packageDoc("pkg-arrived", "u-owner", "pitzutz", { status: "arrived" }),
    );
    const adminDb = dbFor("u-admin");

    await assertSucceeds(adminDb.doc("packages/pkg-waiting").delete());
    await assertSucceeds(adminDb.doc("packages/pkg-arrived").delete());
  });

  it("blocks inactive users from active app data", async () => {
    await seedDoc("users/u-blocked", {
      ...userDoc("u-blocked"),
      verificationStatus: "blocked",
      blockedAt: now,
      blockedByUserId: "u-admin",
    });
    await seedDoc("packages/pkg-visible", packageDoc("pkg-visible", "u-owner"));
    const blockedDb = dbFor("u-blocked");

    await assertFails(blockedDb.doc("packages/pkg-visible").get());
    await assertFails(
      blockedDb.doc("packages/pkg-blocked").set(packageDoc("pkg-blocked", "u-blocked")),
    );
  });
});
