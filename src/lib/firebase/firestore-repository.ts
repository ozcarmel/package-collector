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
import { isOzAdminShortcut, ozAdminFullName, ozAdminPhone } from "@/lib/oz-admin-shortcut";
import type {
  AppOperationsRepository,
  RevealedSensitivePackageDetails,
} from "@/lib/app-repository-contract";
import type {
  ActionDeps,
  CreateJoinRequestInput,
  CreatePackageInput,
  UpdateArrivalInput,
} from "@/lib/app-state-actions";
import type { AppState, DeliveryPackage, JoinRequest, PickupRun, PickupRunItem } from "@/lib/types";

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

    const batch = writeBatch(db);
    batch.set(doc(db, "pickupRuns", runId), run);
    items.forEach((item) => {
      const grantId = `${state.currentUser.id}_${item.packageId}`;
      const accessId = deps.createId("access");
      batch.set(doc(db, "pickupRunItems", item.id), item);
      batch.set(doc(db, "sensitiveAccessGrants", grantId), {
        id: grantId,
        packageId: item.packageId,
        pickupRunId: runId,
        viewerUserId: state.currentUser.id,
        pickupLocationId,
        createdAt,
      });
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
    const userSnapshot = await getDoc(doc(db, "users", request.userId));
    const existingUser = userSnapshot.data() as AppState["users"][number] | undefined;
    const approvedRole =
      existingUser?.role === "admin" || existingUser?.role === "owner"
        ? existingUser.role
        : "member";

    const batch = writeBatch(db);
    batch.update(requestSnapshot.ref, {
      status: "approved",
      reviewedAt: deps.now(),
      reviewedByUserId: state.currentUser.id,
    });
    batch.set(doc(db, "users", request.userId), {
      id: request.userId,
      fullName: request.fullName,
      phone: request.phone,
      role: approvedRole,
      verificationStatus: "approved",
      createdAt: existingUser?.createdAt ?? request.createdAt,
      approvedAt: deps.now(),
      approvedByUserId: state.currentUser.id,
    });

    await batch.commit();
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
    if (state.currentUser.role !== "owner" || state.currentUser.id === userId) {
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
      state.currentUser.role === "owner" &&
      target.role === "admin" &&
      target.verificationStatus === "approved";
    if (!canBlockRegularMember && !canBlockManager) return;

    await updateDoc(doc(db, "users", userId), {
      verificationStatus: "blocked",
      blockedAt: deps.now(),
      blockedByUserId: state.currentUser.id,
    });
  },
};
