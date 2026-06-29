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
import {
  createPackageWithSensitiveDetails,
  markPackageCollectedSecurely,
  startSecurePickupRun,
} from "@/lib/firebase/sensitive-package-functions";
import { parseDeliveryMessage } from "@/lib/message-parser";
import type { AppOperationsRepository } from "@/lib/app-repository-contract";
import type {
  ActionDeps,
  CreateJoinRequestInput,
  CreatePackageInput,
  UpdateArrivalInput,
} from "@/lib/app-state-actions";
import type { AppState, JoinRequest } from "@/lib/types";

function requireFirestore(): Firestore {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* variables first.");
  }

  return db;
}

export const firestoreRepository: AppOperationsRepository = {
  async createJoinRequest(state: AppState, input: CreateJoinRequestInput, deps: ActionDeps) {
    const db = requireFirestore();
    const request: JoinRequest = {
      id: deps.createId("join"),
      userId: state.currentUser.id,
      fullName: input.fullName,
      phone: input.phone,
      note: input.note,
      status: "pending",
      createdAt: deps.now(),
    };

    await setDoc(doc(db, "joinRequests", request.id), request);
    return { requestId: request.id };
  },

  async createPackage(state: AppState, input: CreatePackageInput, deps: ActionDeps) {
    const parsed = parseDeliveryMessage(input.sensitiveDeliveryMessage, state.pickupLocations);
    const packageId = deps.createId("pkg");
    await createPackageWithSensitiveDetails({
      packageId,
      ownerUserId: state.currentUser.id,
      ownerName: input.ownerName,
      pickupLocationId: input.pickupLocationId,
      sensitiveDeliveryMessage: input.sensitiveDeliveryMessage,
      sensitivePickupLink: parsed.pickupLink,
      sensitivePackageCode: parsed.packageCode,
      parsedCourierCompany: parsed.courierCompany,
      parsedAddresseeName: parsed.addresseeName,
      parsedTrackingNumber: parsed.trackingNumber,
      parsedPickupDeadline: parsed.pickupDeadline,
      updatedAt: deps.now(),
    });
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

  async startPickupRun(state: AppState, pickupLocationId: string) {
    const result = await startSecurePickupRun({ pickupLocationId });
    if (!result.runId) {
      return { runId: null, packageCount: 0 };
    }

    return {
      runId: result.runId,
      packageCount: result.packageCount,
      sensitiveDetails: result.sensitiveDetails,
      state: {
        ...state,
        pickupRuns: result.run
          ? [result.run, ...state.pickupRuns.filter((run) => run.id !== result.run?.id)]
          : state.pickupRuns,
        pickupRunItems: result.items
          ? [
              ...result.items,
              ...state.pickupRunItems.filter(
                (item) => !result.items?.some((newItem) => newItem.id === item.id),
              ),
            ]
          : state.pickupRunItems,
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
    await setDoc(doc(db, "sensitiveAccessLogs", accessId), {
      id: accessId,
      packageId: input.packageId,
      pickupRunId: input.activeRunId,
      viewerUserId: state.currentUser.id,
      action: input.action,
      createdAt: deps.now(),
      ownerUserId: packageSnapshot.data()?.ownerUserId,
    });

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
      batch.update(itemDoc.ref, { [field]: deps.now() });
    });
    await batch.commit();
  },

  async markPackageCollected(state: AppState, input: { activeRunId: string | null; packageId: string }) {
    if (!input.activeRunId) {
      throw new Error("A pickup run is required to mark a package collected.");
    }

    const result = await markPackageCollectedSecurely({
      pickupRunId: input.activeRunId,
      packageId: input.packageId,
    });

    return {
      ...state,
      packages: state.packages.map((pkg) =>
        pkg.id === result.packageId
          ? {
              ...pkg,
              status: "collected" as const,
              collectorUserId: state.currentUser.id,
              updatedAt: result.collectedAt,
            }
          : pkg,
      ),
      pickupRunItems: state.pickupRunItems.map((item) =>
        item.pickupRunId === result.pickupRunId && item.packageId === result.packageId
          ? { ...item, itemStatus: "collected" as const, collectedAt: result.collectedAt }
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
      role: "member",
      verificationStatus: "approved",
      createdAt: request.createdAt,
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

  async promoteUser(_state: AppState, userId: string) {
    const db = requireFirestore();
    await updateDoc(doc(db, "users", userId), { role: "admin" });
  },
};
