import { describe, expect, it } from "vitest";
import {
  approveJoinRequest,
  blockUser,
  createJoinRequest,
  createPackage,
  createPickupLocation,
  deletePackage,
  deletePickupLocation,
  getWaitingPackageCount,
  logSensitiveAccess,
  markPackageCollected,
  markPackageReceived,
  promoteUser,
  rejectJoinRequest,
  startPickupRun,
  updateCollectedPackagesArrival,
  updatePickupLocation,
  type ActionDeps,
} from "@/lib/app-state-actions";
import { initialAppState } from "@/lib/demo-data";
import type { AppState } from "@/lib/types";

function cloneState(): AppState {
  return structuredClone(initialAppState) as AppState;
}

function createTestDeps(): ActionDeps {
  let counter = 0;
  return {
    createId(prefix) {
      counter += 1;
      return `${prefix}-${counter}`;
    },
    now() {
      return "2026-06-28T10:00:00.000Z";
    },
  };
}

describe("app state actions", () => {
  it("creates and approves a join request", () => {
    const deps = createTestDeps();
    const created = createJoinRequest(
      cloneState(),
      {
        fullName: "Test Member",
        phone: "050-555-0000",
        note: "Please approve me",
      },
      deps,
    );

    expect(created.requestId).toBe("join-1");
    expect(created.state.joinRequests[0]).toMatchObject({
      id: "join-1",
      userId: "guest-2",
      fullName: "Test Member",
      phone: "050-555-0000",
      status: "pending",
    });

    const approved = approveJoinRequest(created.state, created.requestId, deps);
    expect(approved.joinRequests[0]).toMatchObject({
      id: "join-1",
      status: "approved",
      reviewedByUserId: approved.currentUser.id,
    });
    expect(approved.users.some((user) => user.id === "guest-2")).toBe(true);
  });

  it("lets an approved phone enter from a new session without another admin approval", () => {
    const deps = createTestDeps();
    const result = createJoinRequest(
      cloneState(),
      {
        fullName: "Different Name",
        phone: "0501111111",
      },
      deps,
    );

    expect(result.requestId).toBe("recognized-1");
    expect(result.recognizedApprovedUser).toBe(true);
    expect(result.state.currentUser).toMatchObject({
      fullName: "חבר לדוגמה",
      phone: "050-111-1111",
      role: "member",
      verificationStatus: "approved",
    });
    expect(result.state.joinRequests).toHaveLength(cloneState().joinRequests.length);
  });

  it("treats Israeli local and international phone formats as the same approved phone", () => {
    const deps = createTestDeps();
    const result = createJoinRequest(
      cloneState(),
      {
        fullName: "International Phone",
        phone: "+972501111111",
      },
      deps,
    );

    expect(result.state.currentUser).toMatchObject({
      fullName: "חבר לדוגמה",
      phone: "050-111-1111",
      verificationStatus: "approved",
    });
  });

  it("prevents approving a request when an approved user with the same phone exists", () => {
    const deps = createTestDeps();
    const state: AppState = {
      ...cloneState(),
      joinRequests: [
        {
          id: "join-duplicate",
          userId: "guest-duplicate",
          fullName: "Duplicate Member",
          phone: "0501111111",
          status: "pending",
          createdAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    };

    expect(() => approveJoinRequest(state, "join-duplicate", deps)).toThrow(
      "duplicate-user-phone",
    );
  });

  it("approves a join request as a regular member even when a stale user role exists", () => {
    const deps = createTestDeps();
    const created = createJoinRequest(
      cloneState(),
      {
        fullName: "Stale Owner",
        phone: "050-555-2222",
      },
      deps,
    );
    const staleState: AppState = {
      ...created.state,
      users: [
        {
          id: created.state.joinRequests[0].userId,
          fullName: "Stale Owner",
          phone: "050-555-2222",
          role: "owner",
          verificationStatus: "phone_pending",
          createdAt: "2026-06-28T10:00:00.000Z",
        },
        ...created.state.users,
      ],
    };

    const approved = approveJoinRequest(staleState, created.requestId, deps);

    expect(approved.users.find((user) => user.id === "guest-2")).toMatchObject({
      role: "member",
      verificationStatus: "approved",
    });
  });

  it("rejects a join request without creating a user", () => {
    const deps = createTestDeps();
    const created = createJoinRequest(
      cloneState(),
      { fullName: "Rejected Member", phone: "050-555-1111" },
      deps,
    );

    const rejected = rejectJoinRequest(created.state, created.requestId, deps);
    expect(rejected.joinRequests[0]).toMatchObject({
      id: created.requestId,
      status: "rejected",
      reviewedByUserId: rejected.currentUser.id,
    });
    expect(rejected.users.some((user) => user.id === "guest-2")).toBe(false);
  });

  it("creates a package in the selected pickup location even when message text mentions another location", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const postOfficeBefore = state.pickupLocations.find((location) => location.id === "post-office");
    const pitzutzBefore = state.pickupLocations.find((location) => location.id === "pitzutz");

    const result = createPackage(
      state,
      {
        ownerName: "Manual Selection",
        pickupLocationId: "post-office",
        sensitiveDeliveryMessage:
          "Shipment is waiting at Pitzutz Lahav. Approval link: https://example.com/pickup",
      },
      deps,
    );

    expect(result.packageId).toBe("pkg-1");
    expect(result.state.packages[0]).toMatchObject({
      ownerName: "Manual Selection",
      pickupLocationId: "post-office",
      status: "waiting",
      sensitivePickupLink: "https://example.com/pickup",
    });
    expect(
      result.state.pickupLocations.find((location) => location.id === "post-office")
        ?.activeRequests,
    ).toBe((postOfficeBefore?.activeRequests ?? 0) + 1);
    expect(result.state.pickupLocations.find((location) => location.id === "pitzutz")?.activeRequests).toBe(
      pitzutzBefore?.activeRequests,
    );
  });

  it("blocks unapproved users from creating packages", () => {
    const deps = createTestDeps();
    const state: AppState = {
      ...cloneState(),
      currentUser: {
        ...cloneState().currentUser,
        verificationStatus: "admin_pending",
      },
    };

    expect(() =>
      createPackage(
        state,
        {
          ownerName: "Pending User",
          pickupLocationId: "post-office",
          sensitiveDeliveryMessage: "Package waiting for pickup",
        },
        deps,
      ),
    ).toThrow("User must be approved to create packages.");
  });

  it("creates a pickup location with weekly hours and a generated navigation URL", () => {
    const deps = createTestDeps();
    const state = cloneState();

    const result = createPickupLocation(
      state,
      {
        name: "דואר בדיקה",
        address: "קיבוץ להב",
        openingHours: "א-ה 08:00-13:00",
        weeklyHours: {
          0: [{ open: "08:00", close: "13:00" }],
          1: [{ open: "08:00", close: "13:00" }],
        },
      },
      deps,
    );

    const location = result.state.pickupLocations.find(
      (item) => item.id === result.locationId,
    );
    expect(location).toMatchObject({
      name: "דואר בדיקה",
      address: "קיבוץ להב",
      openingHours: "א-ה 08:00-13:00",
      activeRequests: 0,
      weeklyHours: {
        0: [{ open: "08:00", close: "13:00" }],
      },
    });
    expect(location?.navigationUrl).toContain("https://www.google.com/maps/search/");
    expect(result.state.pickupLocations).toHaveLength(state.pickupLocations.length + 1);
  });

  it("updates an existing pickup location without changing its id or request count", () => {
    const state = cloneState();
    const original = state.pickupLocations.find((location) => location.id === "pitzutz");
    expect(original).toBeTruthy();

    const result = updatePickupLocation(state, {
      locationId: "pitzutz",
      name: "פיצוץ להב מעודכן",
      address: "מרכז להב",
      openingHours: "א-ה 10:00-15:00",
      weeklyHours: {
        0: [{ open: "10:00", close: "15:00" }],
      },
    });

    const updated = result.state.pickupLocations.find((location) => location.id === "pitzutz");
    expect(updated).toMatchObject({
      id: "pitzutz",
      name: "פיצוץ להב מעודכן",
      address: "מרכז להב",
      openingHours: "א-ה 10:00-15:00",
      activeRequests: original?.activeRequests,
      weeklyHours: {
        0: [{ open: "10:00", close: "15:00" }],
      },
    });
    expect(updated?.navigationUrl).toContain(encodeURIComponent("פיצוץ להב מעודכן מרכז להב"));
  });

  it("deletes a pickup location from active state without deleting packages", () => {
    const state = cloneState();
    const result = deletePickupLocation(state, "eshkolot");

    expect(result.state.pickupLocations.some((location) => location.id === "eshkolot")).toBe(
      false,
    );
    expect(result.state.packages).toHaveLength(state.packages.length);
  });

  it("starts pickup run only for waiting packages at the selected location", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const waitingCount = getWaitingPackageCount(state, "pitzutz");
    const result = startPickupRun(state, "pitzutz", deps);

    expect(result.runId).toBe("run-1");
    expect(result.packageCount).toBe(waitingCount);
    expect(result.state.pickupRuns[0]).toMatchObject({
      id: "run-1",
      collectorUserId: state.currentUser.id,
      pickupLocationId: "pitzutz",
      status: "active",
    });
    expect(
      result.state.pickupRunItems.filter((item) => item.pickupRunId === result.runId),
    ).toHaveLength(waitingCount);
    expect(
      result.state.accessLogs.filter((log) => log.pickupRunId === result.runId),
    ).toHaveLength(waitingCount);
  });

  it("does not start pickup run when no packages are waiting at the selected location", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const result = startPickupRun(state, "home-paami", deps);

    expect(result.runId).toBeNull();
    expect(result.packageCount).toBe(0);
    expect(result.state).toEqual(state);
  });

  it("blocks unapproved users from starting pickup runs", () => {
    const deps = createTestDeps();
    const state: AppState = {
      ...cloneState(),
      currentUser: {
        ...cloneState().currentUser,
        verificationStatus: "admin_pending",
      },
    };

    expect(() => startPickupRun(state, "pitzutz", deps)).toThrow(
      "User must be approved to start pickup runs.",
    );
  });

  it("logs sensitive link access and updates the active run item", () => {
    const deps = createTestDeps();
    const runResult = startPickupRun(cloneState(), "pitzutz", deps);
    const packageId = runResult.state.pickupRunItems[0].packageId;

    const updated = logSensitiveAccess(
      runResult.state,
      {
        activeRunId: runResult.runId ?? "",
        packageId,
        action: "open_pickup_link",
      },
      deps,
    );

    expect(updated.accessLogs[0]).toMatchObject({
      packageId,
      pickupRunId: runResult.runId,
      viewerUserId: updated.currentUser.id,
      action: "open_pickup_link",
    });
    expect(
      updated.pickupRunItems.find((item) => item.packageId === packageId)
        ?.sensitivePickupLinkOpenedAt,
    ).toBe("2026-06-28T10:00:00.000Z");
  });

  it("marks a package collected and then updates arrival location", () => {
    const deps = createTestDeps();
    const runResult = startPickupRun(cloneState(), "pitzutz", deps);
    const packageId = runResult.state.pickupRunItems[0].packageId;

    const collected = markPackageCollected(
      runResult.state,
      { activeRunId: runResult.runId, packageId },
      deps,
    );

    expect(collected.packages.find((pkg) => pkg.id === packageId)).toMatchObject({
      status: "collected",
      collectorUserId: collected.currentUser.id,
    });
    expect(collected.pickupRunItems.find((item) => item.packageId === packageId)).toMatchObject({
      itemStatus: "collected",
      collectedAt: "2026-06-28T10:00:00.000Z",
    });

    const arrived = updateCollectedPackagesArrival(
      collected,
      {
        dropLocation: "gate-crate",
        dropNote: "In the gate crate",
      },
      deps,
    );

    expect(arrived.packages.find((pkg) => pkg.id === packageId)).toMatchObject({
      status: "arrived",
      currentKibbutzLocation: "gate-crate",
      currentKibbutzLocationText: "In the gate crate",
    });
  });

  it("lets the package recipient mark an arrived package as delivered", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const arrivedPackage = state.packages.find((pkg) => pkg.status === "arrived");
    expect(arrivedPackage).toBeTruthy();
    const recipientState: AppState = {
      ...state,
      currentUser: {
        id: arrivedPackage?.ownerUserId ?? "",
        fullName: "Package Recipient",
        phone: "050-777-7777",
        role: "member",
        verificationStatus: "approved",
        createdAt: "2026-06-28T10:00:00.000Z",
      },
    };

    const delivered = markPackageReceived(recipientState, arrivedPackage?.id ?? "", deps);

    expect(delivered.packages.find((pkg) => pkg.id === arrivedPackage?.id)).toMatchObject({
      status: "delivered",
      deliveredAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T10:00:00.000Z",
    });
  });

  it("allows admins to delete packages in any status from active state", () => {
    const state = cloneState();
    const arrivedPackage = state.packages.find((pkg) => pkg.status === "arrived");
    expect(arrivedPackage).toBeTruthy();
    const result = deletePackage(state, arrivedPackage?.id ?? "");

    expect(result.packages.some((pkg) => pkg.id === arrivedPackage?.id)).toBe(false);
  });

  it("promotes an approved member to admin", () => {
    const state = cloneState();
    const memberId = state.users.find((user) => user.role === "member")?.id;
    expect(memberId).toBeTruthy();

    const promoted = promoteUser(state, memberId ?? "", createTestDeps());
    expect(promoted.users.find((user) => user.id === memberId)?.role).toBe("admin");
  });

  it("promotes members only when the current owner is Oz with the approved phone number", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const memberId = state.users.find((user) => user.role === "member")?.id ?? "";
    const wrongPhoneOwnerState: AppState = {
      ...state,
      currentUser: {
        ...state.currentUser,
        phone: "050-000-0000",
      },
    };

    const attempted = promoteUser(wrongPhoneOwnerState, memberId, deps);

    expect(attempted.users.find((user) => user.id === memberId)?.role).toBe("member");
  });

  it("blocks an approved member without removing user history", () => {
    const state = cloneState();
    const deps = createTestDeps();
    const memberId = state.users.find((user) => user.role === "member")?.id;
    expect(memberId).toBeTruthy();

    const blocked = blockUser(state, memberId ?? "", deps);

    expect(blocked.users).toHaveLength(state.users.length);
    expect(blocked.users.find((user) => user.id === memberId)).toMatchObject({
      verificationStatus: "blocked",
      blockedByUserId: state.currentUser.id,
      blockedAt: "2026-06-28T10:00:00.000Z",
    });
  });

  it("allows owner to block an admin but prevents admins from blocking managers", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const memberId = state.users.find((user) => user.role === "member")?.id ?? "";
    const withAdmin = promoteUser(state, memberId, deps);
    expect(withAdmin.users.find((user) => user.id === memberId)?.role).toBe("admin");

    const ownerBlocked = blockUser(withAdmin, memberId, deps);
    expect(ownerBlocked.users.find((user) => user.id === memberId)?.verificationStatus).toBe(
      "blocked",
    );

    const adminState: AppState = {
      ...withAdmin,
      currentUser: withAdmin.users.find((user) => user.id === memberId)!,
    };
    const ownerId = adminState.users.find((user) => user.role === "owner")?.id ?? "";
    const adminBlockedOwner = blockUser(adminState, ownerId, deps);
    expect(adminBlockedOwner.users.find((user) => user.id === ownerId)?.verificationStatus).toBe(
      "approved",
    );
  });

  it("allows Oz super admin to block legacy owner records", () => {
    const deps = createTestDeps();
    const state: AppState = {
      ...cloneState(),
      users: [
        ...cloneState().users,
        {
          id: "legacy-owner",
          fullName: "Legacy Owner",
          phone: "050-999-9999",
          role: "owner",
          verificationStatus: "approved",
          createdAt: "2026-06-28T10:00:00.000Z",
          approvedAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    };

    const blocked = blockUser(state, "legacy-owner", deps);

    expect(blocked.users.find((user) => user.id === "legacy-owner")).toMatchObject({
      verificationStatus: "blocked",
      blockedByUserId: state.currentUser.id,
    });
  });

  it("allows Oz super admin to block duplicate Oz owner records", () => {
    const deps = createTestDeps();
    const state: AppState = {
      ...cloneState(),
      users: [
        ...cloneState().users,
        {
          id: "duplicate-oz-owner",
          fullName: "עוז כרמל",
          phone: "0584411883",
          role: "owner",
          verificationStatus: "approved",
          createdAt: "2026-06-28T10:00:00.000Z",
          approvedAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    };

    const blocked = blockUser(state, "duplicate-oz-owner", deps);

    expect(blocked.users.find((user) => user.id === "duplicate-oz-owner")).toMatchObject({
      verificationStatus: "blocked",
      blockedByUserId: state.currentUser.id,
    });
  });

  it("prevents non-Oz owners from blocking managers", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const memberId = state.users.find((user) => user.role === "member")?.id ?? "";
    const withAdmin = promoteUser(state, memberId, deps);
    const wrongPhoneOwnerState: AppState = {
      ...withAdmin,
      currentUser: {
        ...withAdmin.currentUser,
        phone: "050-000-0000",
      },
    };

    const attempted = blockUser(wrongPhoneOwnerState, memberId, deps);

    expect(attempted.users.find((user) => user.id === memberId)?.verificationStatus).toBe(
      "approved",
    );
  });

  it("prevents users from blocking themselves", () => {
    const state = cloneState();
    const deps = createTestDeps();

    const attempted = blockUser(state, state.currentUser.id, deps);

    expect(attempted.currentUser.verificationStatus).toBe("approved");
    expect(attempted.users.find((user) => user.id === state.currentUser.id)).toMatchObject({
      verificationStatus: "approved",
    });
  });

  it("prevents admins from promoting members", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const members = state.users.filter((user) => user.role === "member");
    const adminState = promoteUser(state, members[0].id, deps);
    const nonOwnerState: AppState = {
      ...adminState,
      currentUser: adminState.users.find((user) => user.id === members[0].id)!,
    };

    const attempted = promoteUser(nonOwnerState, members[1].id, deps);

    expect(attempted.users.find((user) => user.id === members[1].id)?.role).toBe("member");
  });

  it("allows admins to block approved regular members", () => {
    const deps = createTestDeps();
    const state = cloneState();
    const members = state.users.filter((user) => user.role === "member");
    const adminState = promoteUser(state, members[0].id, deps);
    const nonOwnerState: AppState = {
      ...adminState,
      currentUser: adminState.users.find((user) => user.id === members[0].id)!,
    };

    const blocked = blockUser(nonOwnerState, members[1].id, deps);

    expect(blocked.users.find((user) => user.id === members[1].id)?.verificationStatus).toBe(
      "blocked",
    );
  });
});
