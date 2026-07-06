import { parseDeliveryMessage } from "@/lib/message-parser";
import {
  isOzAdminShortcut,
  isOzSuperAdminUser,
  normalizePhone,
  ozAdminFullName,
  ozAdminPhone,
} from "@/lib/oz-admin-shortcut";
import type {
  AppState,
  DeliveryPackage,
  KibbutzDropLocation,
  PickupLocation,
  PickupRun,
  PickupRunItem,
  WeeklyOpeningHours,
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

export interface UpdatePackageInput extends CreatePackageInput {
  packageId: string;
}

export interface CreatePickupLocationInput {
  name: string;
  address: string;
  openingHours: string;
  weeklyHours?: WeeklyOpeningHours;
}

export interface UpdatePickupLocationInput extends CreatePickupLocationInput {
  locationId: string;
}

export const kibbutzDropLocationDefaultNotes: Record<KibbutzDropLocation, string> = {
  "gate-crate": "שמתי בדולב",
  kolbo: "שמתי בארון הכלבו למעלה",
  "collector-home": "מוזמנים לקחת ממני, שמתי ליד הדלת",
  "direct-home": "",
  other: "",
};

export interface ArrivalPackageUpdateInput {
  packageId: string;
  dropLocation: KibbutzDropLocation;
  dropNote: string;
}

export interface UpdateArrivalInput {
  updates: ArrivalPackageUpdateInput[];
}

export function getEquivalentUserIdsForCurrentUser(state: AppState) {
  const equivalentUserIds = new Set([state.currentUser.id]);
  const currentPhone = normalizePhone(state.currentUser.phone);

  if (!currentPhone) return equivalentUserIds;

  for (const user of state.users) {
    if (
      user.verificationStatus === "approved" &&
      normalizePhone(user.phone) === currentPhone
    ) {
      equivalentUserIds.add(user.id);
    }
  }

  return equivalentUserIds;
}

export function resolveKibbutzDropNote(dropLocation: KibbutzDropLocation, dropNote: string) {
  return dropNote.trim() || kibbutzDropLocationDefaultNotes[dropLocation];
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function assertApprovedUser(state: AppState, action: string) {
  if (state.currentUser.verificationStatus !== "approved") {
    throw new Error(`User must be approved to ${action}.`);
  }
}

export function createJoinRequest(
  state: AppState,
  input: CreateJoinRequestInput,
  deps: ActionDeps,
) {
  const now = deps.now();

  if (isOzAdminShortcut(input)) {
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

  const normalizedPhone = normalizePhone(input.phone);
  const duplicateApprovedUser = state.users.find(
    (user) =>
      user.verificationStatus === "approved" &&
      normalizePhone(user.phone) === normalizedPhone,
  );

  if (normalizedPhone && duplicateApprovedUser) {
    const approvedSessionUser = {
      ...state.currentUser,
      fullName: duplicateApprovedUser.fullName,
      phone: duplicateApprovedUser.phone,
      role: "member" as const,
      verificationStatus: "approved" as const,
      createdAt: state.currentUser.createdAt || now,
      approvedAt: now,
    };

    return {
      requestId: deps.createId("recognized"),
      recognizedApprovedUser: true,
      state: {
        ...state,
        currentUser: approvedSessionUser,
        users: [
          approvedSessionUser,
          ...state.users.filter((user) => user.id !== approvedSessionUser.id),
        ],
      },
    };
  }

  const duplicatePendingRequest = state.joinRequests.find(
    (request) =>
      request.status === "pending" &&
      normalizePhone(request.phone) === normalizedPhone,
  );

  if (normalizedPhone && duplicatePendingRequest) {
    throw new Error("duplicate-user-phone");
  }

  const request = {
    id: deps.createId("join"),
    userId: deps.createId("guest"),
    fullName: input.fullName,
    phone: input.phone,
    note: input.note,
    status: "pending" as const,
    createdAt: now,
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
  assertApprovedUser(state, "create packages");

  const parsed = parseDeliveryMessage(input.sensitiveDeliveryMessage, state.pickupLocations);
  const now = deps.now();
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
    createdAt: now,
    updatedAt: now,
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

export function updatePackage(state: AppState, input: UpdatePackageInput, deps: ActionDeps) {
  assertApprovedUser(state, "update packages");

  const targetPackage = state.packages.find((pkg) => pkg.id === input.packageId);
  if (!targetPackage) return state;

  if (targetPackage.ownerUserId !== state.currentUser.id) {
    throw new Error("Only the package owner can edit this package.");
  }

  if (targetPackage.status !== "waiting") {
    throw new Error("Only waiting packages can be edited.");
  }

  const parsed = parseDeliveryMessage(input.sensitiveDeliveryMessage, state.pickupLocations);
  const updatedAt = deps.now();

  return {
    ...state,
    packages: state.packages.map((pkg) =>
      pkg.id === input.packageId
        ? {
            ...pkg,
            ownerName: input.ownerName,
            pickupLocationId: input.pickupLocationId,
            publicSummary: "ממתינה לאיסוף",
            sensitiveDeliveryMessage: input.sensitiveDeliveryMessage,
            sensitivePickupLink: parsed.pickupLink,
            sensitivePackageCode: parsed.packageCode,
            parsedCourierCompany: parsed.courierCompany,
            parsedAddresseeName: parsed.addresseeName,
            parsedTrackingNumber: parsed.trackingNumber,
            parsedPickupDeadline: parsed.pickupDeadline,
            updatedAt,
          }
        : pkg,
    ),
    pickupLocations: state.pickupLocations.map((location) => {
      if (targetPackage.pickupLocationId === input.pickupLocationId) return location;
      if (location.id === targetPackage.pickupLocationId) {
        return {
          ...location,
          activeRequests: Math.max(0, location.activeRequests - 1),
        };
      }
      if (location.id === input.pickupLocationId) {
        return { ...location, activeRequests: location.activeRequests + 1 };
      }
      return location;
    }),
  };
}

function createPickupLocationId(state: AppState, name: string, deps: ActionDeps) {
  const baseId = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  const fallbackId = deps.createId("location");
  const preferredId = baseId || fallbackId;
  const existingIds = new Set(state.pickupLocations.map((location) => location.id));

  return existingIds.has(preferredId) ? fallbackId : preferredId;
}

function createNavigationUrl(name: string, address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} ${address}`,
  )}`;
}

export function createPickupLocation(
  state: AppState,
  input: CreatePickupLocationInput,
  deps: ActionDeps,
) {
  const name = input.name.trim();
  const address = input.address.trim();
  const openingHours = input.openingHours.trim();
  const location: PickupLocation = {
    id: createPickupLocationId(state, name, deps),
    name,
    address,
    openingHours,
    navigationUrl: createNavigationUrl(name, address),
    activeRequests: 0,
    ...(input.weeklyHours ? { weeklyHours: input.weeklyHours } : {}),
  };

  return {
    locationId: location.id,
    state: {
      ...state,
      pickupLocations: [...state.pickupLocations, location],
    },
  };
}

export function updatePickupLocation(state: AppState, input: UpdatePickupLocationInput) {
  const name = input.name.trim();
  const address = input.address.trim();
  const openingHours = input.openingHours.trim();
  const existingLocation = state.pickupLocations.find(
    (location) => location.id === input.locationId,
  );

  if (!existingLocation) {
    return { locationId: input.locationId, state };
  }

  const updatedLocation: PickupLocation = {
    ...existingLocation,
    name,
    address,
    openingHours,
    navigationUrl: createNavigationUrl(name, address),
    ...(input.weeklyHours ? { weeklyHours: input.weeklyHours } : { weeklyHours: undefined }),
  };

  return {
    locationId: input.locationId,
    state: {
      ...state,
      pickupLocations: state.pickupLocations.map((location) =>
        location.id === input.locationId ? updatedLocation : location,
      ),
    },
  };
}

export function deletePickupLocation(state: AppState, locationId: string) {
  return {
    locationId,
    state: {
      ...state,
      pickupLocations: state.pickupLocations.filter((location) => location.id !== locationId),
    },
  };
}

export function getWaitingPackageCount(state: AppState, pickupLocationId: string) {
  return state.packages.filter(
    (pkg) => pkg.pickupLocationId === pickupLocationId && pkg.status === "waiting",
  ).length;
}

export function startPickupRun(state: AppState, pickupLocationId: string, deps: ActionDeps) {
  assertApprovedUser(state, "start pickup runs");

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

export function markPackageReceived(state: AppState, packageId: string, deps: ActionDeps) {
  assertApprovedUser(state, "mark packages received");

  const targetPackage = state.packages.find((pkg) => pkg.id === packageId);
  if (!targetPackage) {
    throw new Error("Package was not found.");
  }

  if (targetPackage.ownerUserId !== state.currentUser.id) {
    throw new Error("Only the package owner can mark it received.");
  }

  if (targetPackage.status !== "arrived" && targetPackage.status !== "ready_for_handoff") {
    throw new Error("Only arrived packages can be marked received.");
  }

  const deliveredAt = deps.now();

  return {
    ...state,
    packages: state.packages.map((pkg) =>
      pkg.id === packageId
        ? {
            ...pkg,
            status: "delivered" as const,
            deliveredAt,
            updatedAt: deliveredAt,
          }
        : pkg,
    ),
  };
}

export function updateCollectedPackagesArrival(
  state: AppState,
  input: UpdateArrivalInput,
  deps: ActionDeps,
) {
  const equivalentUserIds = getEquivalentUserIdsForCurrentUser(state);
  const updatesByPackageId = new Map(
    input.updates.map((update) => [
      update.packageId,
      {
        dropLocation: update.dropLocation,
        dropNote: resolveKibbutzDropNote(update.dropLocation, update.dropNote),
      },
    ]),
  );

  return {
    ...state,
    packages: state.packages.map((pkg) => {
      const update = updatesByPackageId.get(pkg.id);
      return update &&
        pkg.status === "collected" &&
        pkg.collectorUserId &&
        equivalentUserIds.has(pkg.collectorUserId)
        ? {
            ...pkg,
            status: "arrived" as const,
            currentKibbutzLocation: update.dropLocation,
            currentKibbutzLocationText: update.dropNote,
            updatedAt: deps.now(),
          }
        : pkg;
    }),
  };
}

export function deletePackage(state: AppState, packageId: string) {
  if (state.currentUser.role !== "admin" && state.currentUser.role !== "owner") {
    throw new Error("Only admins can delete packages.");
  }

  return {
    ...state,
    packages: state.packages.filter((pkg) => pkg.id !== packageId),
    pickupRunItems: state.pickupRunItems.filter((item) => item.packageId !== packageId),
    accessLogs: state.accessLogs.filter((log) => log.packageId !== packageId),
  };
}

export function approveJoinRequest(state: AppState, requestId: string, deps: ActionDeps) {
  const request = state.joinRequests.find((item) => item.id === requestId);
  if (!request) return state;
  const normalizedPhone = normalizePhone(request.phone);
  const duplicateApprovedUser = state.users.find(
    (user) =>
      user.id !== request.userId &&
      user.verificationStatus === "approved" &&
      normalizePhone(user.phone) === normalizedPhone,
  );

  if (normalizedPhone && duplicateApprovedUser) {
    throw new Error("duplicate-user-phone");
  }

  const existingUser = state.users.find((user) => user.id === request.userId);
  const approvedUser = {
    id: request.userId,
    fullName: request.fullName,
    phone: request.phone,
    role: "member" as const,
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
  if (!isOzSuperAdminUser(state.currentUser) || state.currentUser.id === userId) {
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
  if (isOzSuperAdminUser(target)) return state;

  const canBlockRegularMember =
    (state.currentUser.role === "admin" || state.currentUser.role === "owner") &&
    target.role === "member" &&
    target.verificationStatus === "approved";
  const canBlockManager =
    isOzSuperAdminUser(state.currentUser) &&
    (target.role === "admin" || target.role === "owner") &&
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
