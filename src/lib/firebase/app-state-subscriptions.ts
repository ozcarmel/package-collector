import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { initialAppState } from "@/lib/demo-data";
import { getFirebaseDb, hasFirebaseConfig } from "@/lib/firebase/client";
import type {
  AppState,
  AppUser,
  DeliveryPackage,
  JoinRequest,
  PickupLocation,
  PickupRun,
  PickupRunItem,
  SensitiveAccessLog,
} from "@/lib/types";

export type AppStateListener = (state: AppState) => void;
export type AppStateSubscriptionErrorListener = (error: Error) => void;

function sortByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(items: T[]) {
  return [...items].sort((a, b) =>
    (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""),
  );
}

function mergeState(current: AppState, patch: Partial<AppState>): AppState {
  return { ...current, ...patch };
}

function mergePickupLocations(remoteLocations: PickupLocation[]) {
  const remoteIds = new Set(remoteLocations.map((location) => location.id));

  return [
    ...initialAppState.pickupLocations.filter((location) => !remoteIds.has(location.id)),
    ...remoteLocations.filter((location) => !location.isDeleted),
  ];
}

export function mergePendingJoinRequests(
  currentRequests: JoinRequest[],
  pendingRequests: JoinRequest[],
) {
  const pendingIds = new Set(pendingRequests.map((request) => request.id));

  return [
    ...pendingRequests,
    ...currentRequests.filter(
      (request) => request.status !== "pending" && !pendingIds.has(request.id),
    ),
  ];
}

export function subscribeFirestoreAppState(
  currentUser: AppUser,
  onState: AppStateListener,
  onError: AppStateSubscriptionErrorListener,
) {
  const db = getFirebaseDb();
  if (!hasFirebaseConfig() || !db) return null;
  const firestoreDb = db;

  let isDisposed = false;
  let isLoading = false;

  async function loadState() {
    if (isLoading) return;
    isLoading = true;

    try {
      const userSnapshot = await getDoc(doc(firestoreDb, "users", currentUser.id));
      const user = userSnapshot.exists() ? (userSnapshot.data() as AppUser) : currentUser;
      const ownRequestsSnapshot = await getDocs(
        query(collection(firestoreDb, "joinRequests"), where("userId", "==", currentUser.id)),
      );
      const ownRequests = ownRequestsSnapshot.docs.map((item) => item.data() as JoinRequest);
      const isApproved = user.verificationStatus === "approved";
      const isAdmin = isApproved && (user.role === "admin" || user.role === "owner");

      const nextState: AppState = {
        ...initialAppState,
        currentUser: user,
        users: [user],
        joinRequests: ownRequests,
        pickupLocations: [],
        packages: [],
        pickupRuns: [],
        pickupRunItems: [],
        accessLogs: [],
      };

      if (isApproved) {
        const [
          locationsSnapshot,
          packagesSnapshot,
          pickupRunsSnapshot,
          ownSensitiveDetailsSnapshot,
        ] = await Promise.all([
          getDocs(collection(firestoreDb, "pickupLocations")),
          getDocs(collection(firestoreDb, "packages")),
          getDocs(
            query(collection(firestoreDb, "pickupRuns"), where("collectorUserId", "==", user.id)),
          ),
          getDocs(
            query(
              collection(firestoreDb, "sensitivePackageDetails"),
              where("ownerUserId", "==", user.id),
            ),
          ),
        ]);
        const remoteLocations = locationsSnapshot.docs.map(
          (item) => ({ id: item.id, ...item.data() }) as PickupLocation,
        );
        const pickupRuns = sortByUpdatedAt(
          pickupRunsSnapshot.docs.map((item) => item.data() as PickupRun),
        );
        const runItems = (
          await Promise.all(
            pickupRuns.map((run) =>
              getDocs(
                query(collection(firestoreDb, "pickupRunItems"), where("pickupRunId", "==", run.id)),
              ),
            ),
          )
        ).flatMap((snapshot) => snapshot.docs.map((item) => item.data() as PickupRunItem));

        nextState.pickupLocations = mergePickupLocations(remoteLocations);
        const sensitiveDetailsByPackageId = new Map(
          ownSensitiveDetailsSnapshot.docs.map((item) => [
            item.id,
            item.data() as Partial<DeliveryPackage>,
          ]),
        );
        nextState.packages = sortByUpdatedAt(
          packagesSnapshot.docs.map((item) => {
            const pkg = item.data() as DeliveryPackage;
            const details = sensitiveDetailsByPackageId.get(pkg.id);
            return details
              ? {
                  ...pkg,
                  sensitiveDeliveryMessage: details.sensitiveDeliveryMessage,
                  sensitivePickupLink: details.sensitivePickupLink,
                  sensitivePackageCode: details.sensitivePackageCode,
                }
              : pkg;
          }),
        );
        nextState.pickupRuns = pickupRuns;
        nextState.pickupRunItems = runItems;

        if (isAdmin) {
          const [pendingRequestsSnapshot, usersSnapshot, accessLogsSnapshot, runItemsSnapshot] =
            await Promise.all([
              getDocs(
                query(collection(firestoreDb, "joinRequests"), where("status", "==", "pending")),
              ),
              getDocs(collection(firestoreDb, "users")),
              getDocs(collection(firestoreDb, "sensitiveAccessLogs")),
              getDocs(collection(firestoreDb, "pickupRunItems")),
            ]);
          const pendingRequests = pendingRequestsSnapshot.docs.map(
            (item) => item.data() as JoinRequest,
          );

          nextState.joinRequests = mergePendingJoinRequests(ownRequests, pendingRequests);
          nextState.users = usersSnapshot.docs.map((item) => item.data() as AppUser);
          nextState.pickupRunItems = runItemsSnapshot.docs.map(
            (item) => item.data() as PickupRunItem,
          );
          nextState.accessLogs = sortByUpdatedAt(
            accessLogsSnapshot.docs.map((item) => item.data() as SensitiveAccessLog),
          );
        }
      }

      if (!isDisposed) {
        onState(nextState);
      }
    } catch (error) {
      if (!isDisposed) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      isLoading = false;
    }
  }

  void loadState();
  const intervalId = window.setInterval(loadState, 5000);

  return () => {
    isDisposed = true;
    window.clearInterval(intervalId);
  };
}
