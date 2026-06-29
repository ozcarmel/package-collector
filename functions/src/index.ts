import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();

type UserRole = "member" | "admin" | "owner";
type VerificationStatus = "phone_pending" | "admin_pending" | "approved" | "rejected" | "blocked";

interface AppUser {
  id: string;
  role: UserRole;
  verificationStatus: VerificationStatus;
}

interface SecurePackageCreateInput {
  packageId: string;
  ownerUserId: string;
  ownerName: string;
  pickupLocationId: string;
  sensitiveDeliveryMessage: string;
  sensitivePickupLink?: string;
  sensitivePackageCode?: string;
  parsedCourierCompany?: string;
  parsedAddresseeName?: string;
  parsedTrackingNumber?: string;
  parsedPickupDeadline?: string;
  updatedAt: string;
}

interface SecurePickupRevealInput {
  pickupRunId: string;
  packageIds: string[];
}

interface SecurePickupRunInput {
  pickupLocationId: string;
}

interface SecurePackageCollectedInput {
  pickupRunId: string;
  packageId: string;
}

interface PickupRun {
  id: string;
  collectorUserId: string;
  pickupLocationId: string;
  status: "active";
  sensitiveDetailsAccessConfirmedAt: string;
  createdAt: string;
}

interface PickupRunItem {
  id: string;
  pickupRunId: string;
  packageId: string;
  itemStatus: "pending";
  sensitiveMessageViewedAt: string;
}

interface SensitivePackageDetails {
  packageId: string;
  ownerUserId: string;
  sensitiveDeliveryMessage: string;
  sensitivePickupLink?: string;
  sensitivePackageCode?: string;
  createdAt: string;
  updatedAt: string;
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${fieldName} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

async function requireApprovedUser(uid?: string) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in is required.");
  }

  const userSnapshot = await db.doc(`users/${uid}`).get();
  if (!userSnapshot.exists) {
    throw new HttpsError("permission-denied", "User profile was not found.");
  }

  const user = userSnapshot.data() as AppUser;
  if (user.verificationStatus !== "approved") {
    throw new HttpsError("permission-denied", "User is not approved yet.");
  }

  return user;
}

async function getRevealedSensitiveDetails(packageIds: string[], pickupLocationId: string) {
  const detailsEntries = await Promise.all(
    packageIds.map(async (packageId) => {
      const [packageSnapshot, detailsSnapshot] = await Promise.all([
        db.doc(`packages/${packageId}`).get(),
        db.doc(`sensitivePackageDetails/${packageId}`).get(),
      ]);

      if (!packageSnapshot.exists || !detailsSnapshot.exists) {
        throw new HttpsError("not-found", `Package ${packageId} was not found.`);
      }

      const pkg = packageSnapshot.data();
      if (pkg?.pickupLocationId !== pickupLocationId) {
        throw new HttpsError("permission-denied", `Package ${packageId} is not in this pickup run.`);
      }

      const details = detailsSnapshot.data() as SensitivePackageDetails;
      return [
        packageId,
        withoutUndefined({
          sensitiveDeliveryMessage: details.sensitiveDeliveryMessage,
          sensitivePickupLink: details.sensitivePickupLink,
          sensitivePackageCode: details.sensitivePackageCode,
        }),
      ] as const;
    }),
  );

  return Object.fromEntries(detailsEntries);
}

export const createPackageWithSensitiveDetails = onCall(async (request) => {
  await requireApprovedUser(request.auth?.uid);
  const uid = request.auth?.uid;
  const data = request.data as Partial<SecurePackageCreateInput>;
  const packageId = requireString(data.packageId, "packageId");
  const ownerUserId = requireString(data.ownerUserId, "ownerUserId");
  const ownerName = requireString(data.ownerName, "ownerName");
  const pickupLocationId = requireString(data.pickupLocationId, "pickupLocationId");
  const sensitiveDeliveryMessage = requireString(
    data.sensitiveDeliveryMessage,
    "sensitiveDeliveryMessage",
  );
  const updatedAt = optionalString(data.updatedAt) ?? new Date().toISOString();

  if (ownerUserId !== uid) {
    throw new HttpsError("permission-denied", "Only the package owner can create this package.");
  }

  const packageRef = db.doc(`packages/${packageId}`);
  const sensitiveRef = db.doc(`sensitivePackageDetails/${packageId}`);

  await db.runTransaction(async (transaction) => {
    const existingPackage = await transaction.get(packageRef);
    if (existingPackage.exists) {
      throw new HttpsError("already-exists", "Package already exists.");
    }

    transaction.set(packageRef, withoutUndefined({
      id: packageId,
      ownerUserId,
      ownerName,
      pickupLocationId,
      publicSummary: "ממתין לאיסוף",
      status: "waiting",
      sensitiveDeliveryMessage: "",
      parsedCourierCompany: optionalString(data.parsedCourierCompany),
      parsedAddresseeName: optionalString(data.parsedAddresseeName),
      parsedTrackingNumber: optionalString(data.parsedTrackingNumber),
      parsedPickupDeadline: optionalString(data.parsedPickupDeadline),
      updatedAt,
    }));

    const sensitiveDetails: SensitivePackageDetails = {
      packageId,
      ownerUserId,
      sensitiveDeliveryMessage,
      sensitivePickupLink: optionalString(data.sensitivePickupLink),
      sensitivePackageCode: optionalString(data.sensitivePackageCode),
      createdAt: updatedAt,
      updatedAt,
    };
    transaction.set(sensitiveRef, withoutUndefined({ ...sensitiveDetails }));
  });

  return { packageId };
});

export const startSecurePickupRun = onCall(async (request) => {
  const user = await requireApprovedUser(request.auth?.uid);
  const data = request.data as Partial<SecurePickupRunInput>;
  const pickupLocationId = requireString(data.pickupLocationId, "pickupLocationId");
  const packagesSnapshot = await db
    .collection("packages")
    .where("pickupLocationId", "==", pickupLocationId)
    .where("status", "==", "waiting")
    .get();

  if (packagesSnapshot.empty) {
    return { runId: null, packageCount: 0 };
  }

  const createdAt = new Date().toISOString();
  const runRef = db.collection("pickupRuns").doc();
  const run: PickupRun = {
    id: runRef.id,
    collectorUserId: user.id,
    pickupLocationId,
    status: "active",
    sensitiveDetailsAccessConfirmedAt: createdAt,
    createdAt,
  };
  const batch = db.batch();
  const items: PickupRunItem[] = [];

  batch.set(runRef, run);
  packagesSnapshot.docs.forEach((packageDoc) => {
    const itemRef = db.collection("pickupRunItems").doc();
    const accessRef = db.collection("sensitiveAccessLogs").doc();
    const item: PickupRunItem = {
      id: itemRef.id,
      pickupRunId: run.id,
      packageId: packageDoc.id,
      itemStatus: "pending",
      sensitiveMessageViewedAt: createdAt,
    };

    items.push(item);
    batch.set(itemRef, item);
    batch.set(accessRef, {
      id: accessRef.id,
      packageId: packageDoc.id,
      pickupRunId: run.id,
      viewerUserId: user.id,
      action: "view_message",
      createdAt,
      ownerUserId: packageDoc.data().ownerUserId,
    });
  });

  await batch.commit();

  const packageIds = packagesSnapshot.docs.map((packageDoc) => packageDoc.id);
  const sensitiveDetails = await getRevealedSensitiveDetails(packageIds, pickupLocationId);
  return {
    runId: run.id,
    packageCount: packagesSnapshot.size,
    run,
    items,
    sensitiveDetails,
  };
});

export const revealSensitiveDetailsForPickupRun = onCall(async (request) => {
  const user = await requireApprovedUser(request.auth?.uid);
  const data = request.data as Partial<SecurePickupRevealInput>;
  const pickupRunId = requireString(data.pickupRunId, "pickupRunId");
  const packageIds = Array.isArray(data.packageIds)
    ? data.packageIds.map((packageId) => requireString(packageId, "packageIds[]"))
    : [];

  if (packageIds.length === 0) {
    throw new HttpsError("invalid-argument", "packageIds is required.");
  }

  const pickupRunSnapshot = await db.doc(`pickupRuns/${pickupRunId}`).get();
  if (!pickupRunSnapshot.exists) {
    throw new HttpsError("not-found", "Pickup run was not found.");
  }

  const pickupRun = pickupRunSnapshot.data();
  if (pickupRun?.collectorUserId !== user.id) {
    throw new HttpsError("permission-denied", "Only the collector can reveal this pickup run.");
  }

  return getRevealedSensitiveDetails(packageIds, pickupRun.pickupLocationId);
});

export const markPackageCollectedSecurely = onCall(async (request) => {
  const user = await requireApprovedUser(request.auth?.uid);
  const data = request.data as Partial<SecurePackageCollectedInput>;
  const pickupRunId = requireString(data.pickupRunId, "pickupRunId");
  const packageId = requireString(data.packageId, "packageId");
  const collectedAt = new Date().toISOString();

  const runRef = db.doc(`pickupRuns/${pickupRunId}`);
  const packageRef = db.doc(`packages/${packageId}`);

  const itemsSnapshot = await db
    .collection("pickupRunItems")
    .where("pickupRunId", "==", pickupRunId)
    .where("packageId", "==", packageId)
    .limit(1)
    .get();

  if (itemsSnapshot.empty) {
    throw new HttpsError("not-found", "Pickup run item was not found.");
  }

  await db.runTransaction(async (transaction) => {
    const [runSnapshot, packageSnapshot] = await Promise.all([
      transaction.get(runRef),
      transaction.get(packageRef),
    ]);

    if (!runSnapshot.exists) {
      throw new HttpsError("not-found", "Pickup run was not found.");
    }

    if (!packageSnapshot.exists) {
      throw new HttpsError("not-found", "Package was not found.");
    }

    const run = runSnapshot.data();
    if (run?.collectorUserId !== user.id) {
      throw new HttpsError("permission-denied", "Only the run collector can mark this package.");
    }

    const pkg = packageSnapshot.data();
    if (pkg?.pickupLocationId !== run.pickupLocationId) {
      throw new HttpsError("permission-denied", "Package does not belong to this pickup location.");
    }

    if (pkg?.status !== "waiting" && pkg?.status !== "collected") {
      throw new HttpsError("failed-precondition", "Package is not waiting for pickup.");
    }

    transaction.update(packageRef, {
      status: "collected",
      collectorUserId: user.id,
      updatedAt: collectedAt,
    });
    transaction.update(itemsSnapshot.docs[0].ref, {
      itemStatus: "collected",
      collectedAt,
    });
  });

  return { packageId, pickupRunId, collectedAt };
});
