import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { parseDeliveryMessage } from "@/lib/message-parser";
import {
  isOzAdminShortcut,
  isOzSuperAdminUser,
  normalizePhone,
  ozAdminFullName,
  ozAdminPhone,
} from "@/lib/oz-admin-shortcut";
import type {
  AppOperationsRepository,
  RevealedSensitivePackageDetails,
} from "@/lib/app-repository-contract";
import type {
  ActionDeps,
  CreateJoinRequestInput,
  CreatePackageInput,
  CreatePickupLocationInput,
  UpdatePickupLocationInput,
  UpdateArrivalInput,
} from "@/lib/app-state-actions";
import {
  approveJoinRequest as approveJoinRequestAction,
  createPickupLocation as createPickupLocationAction,
  deletePickupLocation as deletePickupLocationAction,
  updatePickupLocation as updatePickupLocationAction,
} from "@/lib/app-state-actions";
import type {
  AppState,
  DeliveryPackage,
  JoinRequest,
  PickupLocation,
  PickupRun,
  PickupRunItem,
} from "@/lib/types";

function requireFirestore(): Firestore {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* variables first.");
  }

  return db;
}

function withoutUndefined<T extends object>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

async function blockDuplicateOzManagers(db: Firestore, currentUserId: string, now: string) {
  const usersSnapshot = await getDocs(
    query(collection(db, "users"), where("phone", "==", ozAdminPhone)),
  );
  const batch = writeBatch(db);
  let hasDuplicate = false;

  usersSnapshot.forEach((snapshot) => {
    const user = snapshot.data() as AppState["users"][number];
    if (
      user.id !== currentUserId &&
      user.verificationStatus === "approved" &&
      (user.role === "admin" || user.role === "owner")
    ) {
      hasDuplicate = true;
      batch.update(snapshot.ref, {
        verificationStatus: "blocked",
        blockedAt: now,
        blockedByUserId: currentUserId,
      });
    }
  });

  if (hasDuplicate) {
    await batch.commit();
  }
}

async function findApprovedUserWithPhone(
  db: Firestore,
  phone: string,
  excludedUserId: string,
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const usersSnapshot = await getDocs(collection(db, "users"));
  return usersSnapshot.docs
    .map((snapshot) => snapshot.data() as AppState["users"][number])
    .find(
      (user) =>
        user.id !== excludedUserId &&
        user.verificationStatus === "approved" &&
        normalizePhone(user.phone) === normalizedPhone,
    );
}

async function approveCurrentSessionFromExistingUser(
  db: Firestore,
  state: AppState,
  approvedUser: AppState["users"][number],
  now: string,
) {
  const approvedSessionUser = {
    ...state.currentUser,
    fullName: approvedUser.fullName,
    phone: approvedUser.phone,
    role: "member" as const,
    verificationStatus: "approved" as const,
    createdAt: state.currentUser.createdAt || now,
    approvedAt: now,
  };

  await setDoc(doc(db, "users", state.currentUser.id), withoutUndefined(approvedSessionUser), {
    merge: true,
  });

  return approvedSessionUser;
}

export const firestoreRepository: AppOperationsRepository = {
  async createJoinRequest(state: AppState, input: CreateJoinRequestInput, deps: ActionDeps) {
    const db = requireFirestore();
    const now = deps.now();
    const isOzAdmin = isOzAdminShortcut(input);
    const request: JoinRequest = {
      id: deps.createId("join"),
      userId: state.currentUser.id,
      fullName: isOzAdmin ? ozAdminFullName : input.fullName,
      phone: isOzAdmin ? ozAdminPhone : input.phone,
      note: input.note,
      status: isOzAdmin ? "approved" : "pending",
      createdAt: now,
      reviewedAt: isOzAdmin ? now : undefined,
      reviewedByUserId: isOzAdmin ? state.currentUser.id : undefined,
    };

    if (!isOzAdmin) {
      const existingApprovedUser = await findApprovedUserWithPhone(db, input.phone, state.currentUser.id);
      if (existingApprovedUser) {
        const approvedSessionUser = await approveCurrentSessionFromExistingUser(
          db,
          state,
          existingApprovedUser,
          now,
        );

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

      const ownJoinRequests = await getDocs(
        query(collection(db, "joinRequests"), where("userId", "==", state.currentUser.id)),
      );
      const hasDuplicateOwnPendingRequest = ownJoinRequests.docs
        .map((snapshot) => snapshot.data() as JoinRequest)
        .some(
          (existingRequest) =>
            existingRequest.status === "pending" &&
            normalizePhone(existingRequest.phone) === normalizePhone(request.phone),
        );

      if (hasDuplicateOwnPendingRequest) {
        throw new Error("duplicate-user-phone");
      }

      await setDoc(doc(db, "joinRequests", request.id), withoutUndefined(request));
      return { requestId: request.id };
    }

    const adminUser = {
      ...state.currentUser,
      fullName: ozAdminFullName,
      phone: ozAdminPhone,
      role: "owner" as const,
      verificationStatus: "approved" as const,
      approvedAt: now,
    };
    const batch = writeBatch(db);
    batch.set(doc(db, "joinRequests", request.id), withoutUndefined(request));
    batch.set(doc(db, "users", state.currentUser.id), withoutUndefined(adminUser), { merge: true });
    await batch.commit();
    await blockDuplicateOzManagers(db, state.currentUser.id, now);
    return {
      requestId: request.id,
      state: {
        ...state,
        currentUser: adminUser,
        users: [adminUser, ...state.users.filter((user) => user.id !== adminUser.id)],
        joinRequests: [request, ...state.joinRequests],
      },
    };
  },

  async createPackage(state: AppState, input: CreatePackageInput, deps: ActionDeps) {
    if (state.currentUser.verificationStatus !== "approved") {
      throw new Error("User must be approved to create packages.");
    }

    const db = requireFirestore();
    const parsed = parseDeliveryMessage(input.sensitiveDeliveryMessage, state.pickupLocations);
    const packageId = deps.createId("pkg");
    const updatedAt = deps.now();
    const publicPackage: DeliveryPackage = {
      id: packageId,
      ownerUserId: state.currentUser.id,
      ownerName: input.ownerName,
      pickupLocationId: input.pickupLocationId,
      publicSummary: "ממתינה לאיסוף",
      status: "waiting",
      parsedCourierCompany: parsed.courierCompany,
      parsedAddresseeName: parsed.addresseeName,
      parsedTrackingNumber: parsed.trackingNumber,
      parsedPickupDeadline: parsed.pickupDeadline,
      updatedAt,
    };

    const batch = writeBatch(db);
    batch.set(doc(db, "packages", packageId), withoutUndefined(publicPackage));
    batch.set(doc(db, "sensitivePackageDetails", packageId), withoutUndefined({
      packageId,
      ownerUserId: state.currentUser.id,
      pickupLocationId: input.pickupLocationId,
      sensitiveDeliveryMessage: input.sensitiveDeliveryMessage,
      sensitivePickupLink: parsed.pickupLink,
      sensitivePackageCode: parsed.packageCode,
      createdAt: updatedAt,
      updatedAt,
    }));
    await batch.commit();
    return { packageId };
  },

  async createPickupLocation(
    state: AppState,
    input: CreatePickupLocationInput,
    deps: ActionDeps,
  ) {
    if (state.currentUser.role !== "admin" && state.currentUser.role !== "owner") {
      throw new Error("Only admins can create pickup locations.");
    }

    const db = requireFirestore();
    const result = createPickupLocationAction(state, input, deps);
    const location = result.state.pickupLocations.find(
      (item) => item.id === result.locationId,
    ) as PickupLocation | undefined;

    if (!location) {
      throw new Error("Pickup location was not created.");
    }

    await setDoc(doc(db, "pickupLocations", location.id), withoutUndefined(location));
    return result;
  },

  async updatePickupLocation(
    state: AppState,
    input: UpdatePickupLocationInput,
  ) {
    if (state.currentUser.role !== "admin" && state.currentUser.role !== "owner") {
      throw new Error("Only admins can update pickup locations.");
    }

    const db = requireFirestore();
    const result = updatePickupLocationAction(state, input);
    const location = result.state.pickupLocations.find(
      (item) => item.id === result.locationId,
    ) as PickupLocation | undefined;

    if (!location) {
      throw new Error("Pickup location was not found.");
    }

    await setDoc(doc(db, "pickupLocations", location.id), withoutUndefined(location));
    return result;
  },

  async deletePickupLocation(
    state: AppState,
    locationId: string,
    deps: ActionDeps,
  ) {
    if (state.currentUser.role !== "admin" && state.currentUser.role !== "owner") {
      throw new Error("Only admins can delete pickup locations.");
    }

    const db = requireFirestore();
    const existingLocation = state.pickupLocations.find((location) => location.id === locationId);
    const result = deletePickupLocationAction(state, locationId);
    const deletedAt = deps.now();
    const tombstone: PickupLocation = {
      id: locationId,
      name: existingLocation?.name ?? locationId,
      address: existingLocation?.address ?? "",
      openingHours: existingLocation?.openingHours ?? "",
      weeklyHours: existingLocation?.weeklyHours,
      navigationUrl: existingLocation?.navigationUrl ?? "",
      activeRequests: existingLocation?.activeRequests ?? 0,
      isDeleted: true,
      deletedAt,
      deletedByUserId: state.currentUser.id,
    };

    await setDoc(doc(db, "pickupLocations", locationId), withoutUndefined(tombstone), {
      merge: true,
    });
    return result;
  },

  async getWaitingPackageCount(_state: AppState, pickupLocationId: string) {
    const db = requireFirestore();
    const snapshot = await getDocs(
      query(
        collection(db, "packages"),
        where("pickupLocationId", "==", pickupLocationId),
        where("status", "==", "waiting"),
      ),
    );

    return snapshot.size;
  },

  async startPickupRun(state: AppState, pickupLocationId: string, deps: ActionDeps) {
    if (state.currentUser.verificationStatus !== "approved") {
      throw new Error("User must be approved to start pickup runs.");
    }

    const db = requireFirestore();
    const packagesSnapshot = await getDocs(
      query(
        collection(db, "packages"),
        where("pickupLocationId", "==", pickupLocationId),
        where("status", "==", "waiting"),
      ),
    );
    const packages = packagesSnapshot.docs.map((item) => item.data() as DeliveryPackage);

    if (packages.length === 0) {
      return { runId: null, packageCount: 0 };
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
    const items: PickupRunItem[] = packages.map((pkg) => ({
      id: `${runId}_${pkg.id}`,
      pickupRunId: runId,
      packageId: pkg.id,
      itemStatus: "pending",
      sensitiveMessageViewedAt: createdAt,
    }));

    const packageIdsForLocation = new Set(packages.map((pkg) => pkg.id));
    const existingGrantsSnapshot = await getDocs(
      query(
        collection(db, "sensitiveAccessGrants"),
        where("viewerUserId", "==", state.currentUser.id),
      ),
    );
    const existingGrantIds = new Set(
      existingGrantsSnapshot.docs
        .map((grantDoc) => grantDoc.data() as { id?: string; packageId?: string })
        .filter((grant) => grant.id && grant.packageId && packageIdsForLocation.has(grant.packageId))
        .map((grant) => grant.id as string),
    );

    const batch = writeBatch(db);
    batch.set(doc(db, "pickupRuns", runId), run);
    items.forEach((item) => {
      const grantId = `${state.currentUser.id}_${item.packageId}`;
      const accessId = deps.createId("access");
      batch.set(doc(db, "pickupRunItems", item.id), item);
      if (!existingGrantIds.has(grantId)) {
        batch.set(doc(db, "sensitiveAccessGrants", grantId), {
          id: grantId,
          packageId: item.packageId,
          pickupRunId: runId,
          viewerUserId: state.currentUser.id,
          pickupLocationId,
          createdAt,
        });
      }
      batch.set(doc(db, "sensitiveAccessLogs", accessId), withoutUndefined({
        id: accessId,
        packageId: item.packageId,
        pickupRunId: runId,
        viewerUserId: state.currentUser.id,
        action: "view_message",
        createdAt,
        ownerUserId: packages.find((pkg) => pkg.id === item.packageId)?.ownerUserId,
      }));
    });
    await batch.commit();

    const sensitiveDetails: RevealedSensitivePackageDetails = {};
    await Promise.all(
      packages.map(async (pkg) => {
        const detailsSnapshot = await getDoc(doc(db, "sensitivePackageDetails", pkg.id));
        const details = detailsSnapshot.data() as
          | {
              sensitiveDeliveryMessage?: string;
              sensitivePickupLink?: string;
              sensitivePackageCode?: string;
            }
          | undefined;
        if (details?.sensitiveDeliveryMessage) {
          sensitiveDetails[pkg.id] = {
            sensitiveDeliveryMessage: details.sensitiveDeliveryMessage,
            sensitivePickupLink: details.sensitivePickupLink,
            sensitivePackageCode: details.sensitivePackageCode,
          };
        }
      }),
    );

    return {
      runId,
      packageCount: packages.length,
      sensitiveDetails,
      state: {
        ...state,
        pickupRuns: [run, ...state.pickupRuns.filter((item) => item.id !== run.id)],
        pickupRunItems: [
          ...items,
          ...state.pickupRunItems.filter(
            (item) => !items.some((newItem) => newItem.id === item.id),
          ),
        ],
      },
    };
  },

  async logSensitiveAccess(
    state: AppState,
    input: {
      activeRunId: string;
      packageId: string;
      action: "view_message" | "open_pickup_link";
    },
    deps: ActionDeps,
  ) {
    const db = requireFirestore();
    const packageSnapshot = await getDoc(doc(db, "packages", input.packageId));
    const accessId = deps.createId("access");
    const now = deps.now();
    await setDoc(doc(db, "sensitiveAccessLogs", accessId), withoutUndefined({
      id: accessId,
      packageId: input.packageId,
      pickupRunId: input.activeRunId,
      viewerUserId: state.currentUser.id,
      action: input.action,
      createdAt: now,
      ownerUserId: packageSnapshot.data()?.ownerUserId,
    }));

    const itemsSnapshot = await getDocs(
      query(
        collection(db, "pickupRunItems"),
        where("pickupRunId", "==", input.activeRunId),
        where("packageId", "==", input.packageId),
      ),
    );
    const field =
      input.action === "view_message"
        ? "sensitiveMessageViewedAt"
        : "sensitivePickupLinkOpenedAt";
    const batch = writeBatch(db);
    itemsSnapshot.docs.forEach((itemDoc) => {
      batch.update(itemDoc.ref, { [field]: now });
    });
    await batch.commit();
  },

  async markPackageCollected(
    state: AppState,
    input: { activeRunId: string | null; packageId: string },
    deps: ActionDeps,
  ) {
    if (!input.activeRunId) {
      throw new Error("A pickup run is required to mark a package collected.");
    }

    const db = requireFirestore();
    const collectedAt = deps.now();
    const itemId = `${input.activeRunId}_${input.packageId}`;
    const batch = writeBatch(db);
    batch.update(doc(db, "packages", input.packageId), {
      status: "collected",
      collectorUserId: state.currentUser.id,
      updatedAt: collectedAt,
    });
    batch.update(doc(db, "pickupRunItems", itemId), {
      itemStatus: "collected",
      collectedAt,
    });
    await batch.commit();

    return {
      ...state,
      packages: state.packages.map((pkg) =>
        pkg.id === input.packageId
          ? {
              ...pkg,
              status: "collected" as const,
              collectorUserId: state.currentUser.id,
              updatedAt: collectedAt,
            }
          : pkg,
      ),
      pickupRunItems: state.pickupRunItems.map((item) =>
        item.pickupRunId === input.activeRunId && item.packageId === input.packageId
          ? { ...item, itemStatus: "collected" as const, collectedAt }
          : item,
      ),
    };
  },

  async markPackageReceived(state: AppState, packageId: string, deps: ActionDeps) {
    const db = requireFirestore();
    const packageRef = doc(db, "packages", packageId);
    const packageSnapshot = await getDoc(packageRef);
    const pkg = packageSnapshot.data() as DeliveryPackage | undefined;

    if (!pkg) {
      throw new Error("Package was not found.");
    }

    if (pkg.ownerUserId !== state.currentUser.id) {
      throw new Error("Only the package owner can mark it received.");
    }

    if (pkg.status !== "arrived" && pkg.status !== "ready_for_handoff") {
      throw new Error("Only arrived packages can be marked received.");
    }

    const deliveredAt = deps.now();
    await updateDoc(packageRef, {
      status: "delivered",
      deliveredAt,
      updatedAt: deliveredAt,
    });

    return {
      ...state,
      packages: state.packages.map((item) =>
        item.id === packageId
          ? {
              ...item,
              status: "delivered" as const,
              deliveredAt,
              updatedAt: deliveredAt,
            }
          : item,
      ),
    };
  },

  async deletePackage(state: AppState, packageId: string) {
    if (state.currentUser.role !== "admin" && state.currentUser.role !== "owner") {
      throw new Error("Only admins can delete packages.");
    }

    const db = requireFirestore();
    const runItemsSnapshot = await getDocs(
      query(collection(db, "pickupRunItems"), where("packageId", "==", packageId)),
    );
    const batch = writeBatch(db);

    batch.delete(doc(db, "packages", packageId));
    runItemsSnapshot.docs.forEach((itemDoc) => {
      batch.delete(itemDoc.ref);
    });

    await batch.commit();

    return {
      ...state,
      packages: state.packages.filter((pkg) => pkg.id !== packageId),
      pickupRunItems: state.pickupRunItems.filter((item) => item.packageId !== packageId),
      accessLogs: state.accessLogs.filter((log) => log.packageId !== packageId),
    };
  },

  async updateCollectedPackagesArrival(
    state: AppState,
    input: UpdateArrivalInput,
    deps: ActionDeps,
  ) {
    const db = requireFirestore();
    const packagesSnapshot = await getDocs(
      query(
        collection(db, "packages"),
        where("collectorUserId", "==", state.currentUser.id),
        where("status", "==", "collected"),
      ),
    );
    const batch = writeBatch(db);
    packagesSnapshot.docs.forEach((packageDoc) => {
      batch.update(packageDoc.ref, {
        status: "arrived",
        currentKibbutzLocation: input.dropLocation,
        currentKibbutzLocationText: input.dropNote,
        updatedAt: deps.now(),
      });
    });

    await batch.commit();
  },

  async approveJoinRequest(state: AppState, requestId: string, deps: ActionDeps) {
    const db = requireFirestore();
    const requestSnapshot = await getDoc(doc(db, "joinRequests", requestId));
    const request = requestSnapshot.data() as JoinRequest | undefined;
    if (!request) return;
    const duplicateUser = await findApprovedUserWithPhone(db, request.phone, request.userId);
    if (duplicateUser) {
      throw new Error("duplicate-user-phone");
    }

    const userSnapshot = await getDoc(doc(db, "users", request.userId));
    const existingUser = userSnapshot.data() as AppState["users"][number] | undefined;
    const isAlreadyApproved = existingUser?.verificationStatus === "approved";

    const batch = writeBatch(db);
    batch.update(requestSnapshot.ref, {
      status: "approved",
      reviewedAt: deps.now(),
      reviewedByUserId: state.currentUser.id,
    });

    if (!isAlreadyApproved) {
      batch.set(
        doc(db, "users", request.userId),
        {
          id: request.userId,
          fullName: request.fullName,
          phone: request.phone,
          role: "member",
          verificationStatus: "approved",
          createdAt: existingUser?.createdAt ?? request.createdAt,
          approvedAt: deps.now(),
          approvedByUserId: state.currentUser.id,
        },
        { merge: true },
      );
    }

    await batch.commit();

    if (isAlreadyApproved) {
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
      };
    }

    return approveJoinRequestAction(
      {
        ...state,
        joinRequests: state.joinRequests.some((item) => item.id === requestId)
          ? state.joinRequests
          : [request, ...state.joinRequests],
      },
      requestId,
      deps,
    );
  },

  async rejectJoinRequest(state: AppState, requestId: string, deps: ActionDeps) {
    const db = requireFirestore();
    await updateDoc(doc(db, "joinRequests", requestId), {
      status: "rejected",
      reviewedAt: deps.now(),
      reviewedByUserId: state.currentUser.id,
    });
  },

  async promoteUser(state: AppState, userId: string) {
    if (!isOzSuperAdminUser(state.currentUser) || state.currentUser.id === userId) {
      return;
    }

    const db = requireFirestore();
    await updateDoc(doc(db, "users", userId), { role: "admin" });
  },

  async blockUser(state: AppState, userId: string, deps: ActionDeps) {
    if (state.currentUser.id === userId) {
      return;
    }

    const db = requireFirestore();
    const userSnapshot = await getDoc(doc(db, "users", userId));
    const target = userSnapshot.data() as AppState["users"][number] | undefined;
    if (!target) return;

    const canBlockRegularMember =
      (state.currentUser.role === "admin" || state.currentUser.role === "owner") &&
      target.role === "member" &&
      target.verificationStatus === "approved";
    const canBlockManager =
      isOzSuperAdminUser(state.currentUser) &&
      (target.role === "admin" || target.role === "owner") &&
      target.verificationStatus === "approved";
    if (!canBlockRegularMember && !canBlockManager) return;

    await updateDoc(doc(db, "users", userId), {
      verificationStatus: "blocked",
      blockedAt: deps.now(),
      blockedByUserId: state.currentUser.id,
    });
  },
};
