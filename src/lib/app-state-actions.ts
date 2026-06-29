import { parseDeliveryMessage } from "@/lib/message-parser";
import { isOzAdminShortcut, ozAdminFullName, ozAdminPhone } from "@/lib/oz-admin-shortcut";
import type {
  AppState,
  DeliveryPackage,
  KibbutzDropLocation,
  PickupRun,
  PickupRunItem,
  UserRole,
} from "@/lib/types";

export type IdFactory = (prefix: string) => string;
export type Clock = () => string;

export interface ActionDeps {
  createId: IdFactory;
  now: Clock;
}

export interface CreateJoinRequestInput {
  fullName: string;
  phone: string;
  note?: string;
}

export interface CreatePackageInput {
  ownerName: string;
  pickupLocationId: string;
  sensitiveDeliveryMessage: string;
}

export interface UpdateArrivalInput {
  dropLocation: KibbutzDropLocation;
  dropNote: string;
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createJoinRequest(
  state: AppState,
  input: CreateJoinRequestInput,
  deps: ActionDeps,
) {
  if (isOzAdminShortcut(input)) {
    const now = deps.now();
    const adminUser = {
      ...state.currentUser,
      fullName: ozAdminFullName,
      phone: ozAdminPhone,
      role: "owner" as const,
      verificationStatus: "approved" as const,
      approvedAt: now,
    };
    const request = {
      id: deps.createId("join"),
      userId: state.currentUser.id,
      fullName: ozAdminFullName,
      phone: ozAdminPhone,
      note: input.note,
      status: "approved" as const,
      createdAt: now,
      reviewedAt: now,
      reviewedByUserId: state.currentUser.id,
    };

    return {
      requestId: request.id,
      state: {
        ...state,
        currentUser: adminUser,
        users: [adminUser, ...state.users.filter((user) => user.id !== adminUser.id)],
        joinRequests: [request, ...state.joinRequests],
      },
    };
  }

  const request = {
    id: deps.createId("join"),
    userId: deps.createId("guest"),
    fullName: input.fullName,
    phone: input.phone,
    note: input.note,
    status: "pending" as const,
    createdAt: deps.now(),
  };

  return {
    requestId: request.id,
    state: {
      ...state,
      joinRequests: [request, ...state.joinRequests],
    },
  };
}

export function createPackage(state: AppState, input: CreatePackageInput, deps: ActionDeps) {
  const parsed = parseDeliveryMessage(input.sensitiveDeliveryMessage, state.pickupLocations);
  const newPackage: DeliveryPackage = {
    id: deps.createId("pkg"),
    ownerUserId: state.currentUser.id,
    ownerName: input.ownerName,
    pickupLocationId: input.pickupLocationId,
    publicSummary: "ממתינה לאיסוף",
    status: "waiting",
    sensitiveDeliveryMessage: input.sensitiveDeliveryMessage,
    sensitivePickupLink: parsed.pickupLink,
    sensitivePackageCode: parsed.packageCode,
    parsedCourierCompany: parsed.courierCompany,
    parsedAddresseeName: parsed.addresseeName,
    parsedTrackingNumber: parsed.trackingNumber,
    parsedPickupDeadline: parsed.pickupDeadline,
    updatedAt: deps.now(),
  };

  return {
    packageId: newPackage.id,
    state: {
      ...state,
      packages: [newPackage, ...state.packages],
      pickupLocations: state.pickupLocations.map((location) =>
        location.id === input.pickupLocationId
          ? { ...location, activeRequests: location.activeRequests + 1 }
          : location,
      ),
    },
  };
}

export function getWaitingPackageCount(state: AppState, pickupLocationId: string) {
  return state.packages.filter(
    (pkg) => pkg.pickupLocationId === pickupLocationId && pkg.status === "waiting",
  ).length;
}

export function startPickupRun(state: AppState, pickupLocationId: string, deps: ActionDeps) {
  const packagesForLocation = state.packages.filter(
    (pkg) => pkg.pickupLocationId === pickupLocationId && pkg.status === "waiting",
  );
  if (packagesForLocation.length === 0) {
    return { state, runId: null, packageCount: 0 };
  }

  const runId = deps.createId("run");
  const createdAt = deps.now();
  const run: PickupRun = {
    id: runId,
    collectorUserId: state.currentUser.id,
    pickupLocationId,
    status: "active",
    sensitiveDetailsAccessConfirmedAt: createdAt,
    createdAt,
  };
  const items: PickupRunItem[] = packagesForLocation.map((pkg) => ({
    id: deps.createId("run-item"),
    pickupRunId: runId,
    packageId: pkg.id,
    itemStatus: "pending",
    sensitiveMessageViewedAt: createdAt,
  }));
  const viewLogs = packagesForLocation.map((pkg) => ({
    id: deps.createId("access"),
    packageId: pkg.id,
    pickupRunId: runId,
    viewerUserId: state.currentUser.id,
    action: "view_message" as const,
    createdAt,
  }));

  return {
    runId,
    packageCount: packagesForLocation.length,
    state: {
      ...state,
      accessLogs: [...viewLogs, ...state.accessLogs],
      pickupRuns: [run, ...state.pickupRuns],
      pickupRunItems: [...items, ...state.pickupRunItems],
    },
  };
}

export function logSensitiveAccess(
  state: AppState,
  input: {
    activeRunId: string;
    packageId: string;
    action: "view_message" | "open_pickup_link";
  },
  deps: ActionDeps,
) {
  return {
    ...state,
    accessLogs: [
      {
        id: deps.createId("access"),
        packageId: input.packageId,
        pickupRunId: input.activeRunId,
        viewerUserId: state.currentUser.id,
        action: input.action,
        createdAt: deps.now(),
      },
      ...state.accessLogs,
    ],
    pickupRunItems: state.pickupRunItems.map((item) => {
      if (item.pickupRunId !== input.activeRunId || item.packageId !== input.packageId) {
        return item;
      }
      return input.action === "view_message"
        ? { ...item, sensitiveMessageViewedAt: deps.now() }
        : { ...item, sensitivePickupLinkOpenedAt: deps.now() };
    }),
  };
}

export function markPackageCollected(
  state: AppState,
  input: { activeRunId: string | null; packageId: string },
  deps: ActionDeps,
) {
  return {
    ...state,
    packages: state.packages.map((pkg) =>
      pkg.id === input.packageId
        ? {
            ...pkg,
            status: "collected" as const,
            collectorUserId: state.currentUser.id,
            updatedAt: deps.now(),
          }
        : pkg,
    ),
    pickupRunItems: state.pickupRunItems.map((item) =>
      item.packageId === input.packageId && item.pickupRunId === input.activeRunId
        ? { ...item, itemStatus: "collected" as const, collectedAt: deps.now() }
        : item,
    ),
  };
}

export function updateCollectedPackagesArrival(
  state: AppState,
  input: UpdateArrivalInput,
  deps: ActionDeps,
) {
  return {
    ...state,
    packages: state.packages.map((pkg) =>
      pkg.status === "collected" && pkg.collectorUserId === state.currentUser.id
        ? {
            ...pkg,
            status: "arrived" as const,
            currentKibbutzLocation: input.dropLocation,
            currentKibbutzLocationText: input.dropNote,
            updatedAt: deps.now(),
          }
        : pkg,
    ),
  };
}

export function approveJoinRequest(state: AppState, requestId: string, deps: ActionDeps) {
  const request = state.joinRequests.find((item) => item.id === requestId);
  if (!request) return state;
  const existingUser = state.users.find((user) => user.id === request.userId);
  const approvedRole: UserRole =
    existingUser?.role === "admin" || existingUser?.role === "owner"
      ? existingUser.role
      : "member";
  const approvedUser = {
    id: request.userId,
    fullName: request.fullName,
    phone: request.phone,
    role: approvedRole,
    verificationStatus: "approved" as const,
    createdAt: existingUser?.createdAt ?? request.createdAt,
    approvedAt: deps.now(),
    approvedByUserId: state.currentUser.id,
  };

  return {
    ...state,
    joinRequests: state.joinRequests.map((item) =>
      item.id === requestId
        ? {
            ...item,
            status: "approved" as const,
            reviewedAt: deps.now(),
            reviewedByUserId: state.currentUser.id,
          }
        : item,
    ),
    users: [
      approvedUser,
      ...state.users.filter((user) => user.id !== request.userId),
    ],
  };
}

export function rejectJoinRequest(state: AppState, requestId: string, deps: ActionDeps) {
  return {
    ...state,
    joinRequests: state.joinRequests.map((item) =>
      item.id === requestId
        ? {
            ...item,
            status: "rejected" as const,
            reviewedAt: deps.now(),
            reviewedByUserId: state.currentUser.id,
          }
        : item,
    ),
  };
}

export function promoteUser(state: AppState, userId: string, _deps: ActionDeps) {
  if (state.currentUser.role !== "owner" || state.currentUser.id === userId) {
    return state;
  }

  return {
    ...state,
    users: state.users.map((user) =>
      user.id === userId && user.role === "member" && user.verificationStatus === "approved"
        ? { ...user, role: "admin" as const }
        : user,
    ),
  };
}

export function blockUser(state: AppState, userId: string, deps: ActionDeps) {
  if (state.currentUser.id === userId) {
    return state;
  }

  const target = state.users.find((user) => user.id === userId);
  if (!target) return state;

  const canBlockRegularMember =
    (state.currentUser.role === "admin" || state.currentUser.role === "owner") &&
    target.role === "member" &&
    target.verificationStatus === "approved";
  const canBlockManager =
    state.currentUser.role === "owner" &&
    target.role === "admin" &&
    target.verificationStatus === "approved";

  if (!canBlockRegularMember && !canBlockManager) {
    return state;
  }

  return {
    ...state,
    users: state.users.map((user) =>
      user.id === userId
        ? {
            ...user,
            verificationStatus: "blocked" as const,
            blockedAt: deps.now(),
            blockedByUserId: state.currentUser.id,
          }
        : user,
    ),
  };
}
