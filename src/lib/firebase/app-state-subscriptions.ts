import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
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
    ...remoteLocations,
  ];
}

export function subscribeFirestoreAppState(
  currentUser: AppUser,
  onState: AppStateListener,
  onError: AppStateSubscriptionErrorListener,
) {
  const db = getFirebaseDb();
  if (!hasFirebaseConfig() || !db) return null;

  let state: AppState = {
    ...initialAppState,
    currentUser,
    users: [currentUser],
    joinRequests: [],
    pickupLocations: [],
    packages: [],
    pickupRuns: [],
    pickupRunItems: [],
    accessLogs: [],
  };

  const unsubs: Unsubscribe[] = [];
  const emit = (patch: Partial<AppState>) => {
    state = mergeState(state, patch);
    onState(state);
  };
  const handleError = (error: Error) => onError(error);

  unsubs.push(
    onSnapshot(
      doc(db, "users", currentUser.id),
      (snapshot) => {
        const user = snapshot.exists() ? (snapshot.data() as AppUser) : currentUser;
        emit({
          currentUser: user,
          users: [user, ...state.users.filter((item) => item.id !== user.id)],
        });
      },
      handleError,
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "joinRequests"), where("userId", "==", currentUser.id)),
      (snapshot) => {
        const ownRequests = snapshot.docs.map((item) => item.data() as JoinRequest);
        emit({
          joinRequests: [
            ...ownRequests,
            ...state.joinRequests.filter((request) => request.userId !== currentUser.id),
          ],
        });
      },
      handleError,
    ),
  );

  if (currentUser.verificationStatus !== "approved") {
    onState(state);
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  unsubs.push(
    onSnapshot(
      collection(db, "pickupLocations"),
      (snapshot) => {
        const remoteLocations = snapshot.docs.map((item) => item.data() as PickupLocation);
        emit({
          pickupLocations: mergePickupLocations(remoteLocations),
        });
      },
      handleError,
    ),
  );

  unsubs.push(
    onSnapshot(
      collection(db, "packages"),
      (snapshot) => {
        emit({
          packages: sortByUpdatedAt(snapshot.docs.map((item) => item.data() as DeliveryPackage)),
        });
      },
      handleError,
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "pickupRuns"), where("collectorUserId", "==", currentUser.id)),
      (snapshot) => {
        emit({
          pickupRuns: sortByUpdatedAt(snapshot.docs.map((item) => item.data() as PickupRun)),
        });
      },
      handleError,
    ),
  );

  unsubs.push(
    onSnapshot(
      collection(db, "pickupRunItems"),
      (snapshot) => {
        emit({
          pickupRunItems: snapshot.docs.map((item) => item.data() as PickupRunItem),
        });
      },
      handleError,
    ),
  );

  if (currentUser.role === "admin" || currentUser.role === "owner") {
    unsubs.push(
      onSnapshot(
        query(collection(db, "joinRequests"), where("status", "==", "pending")),
        (snapshot) => {
          const pendingRequests = snapshot.docs.map((item) => item.data() as JoinRequest);
          const pendingIds = new Set(pendingRequests.map((request) => request.id));
          emit({
            joinRequests: [
              ...pendingRequests,
              ...state.joinRequests.filter((request) => !pendingIds.has(request.id)),
            ],
          });
        },
        handleError,
      ),
    );

    unsubs.push(
      onSnapshot(
        collection(db, "users"),
        (snapshot) => {
          emit({ users: snapshot.docs.map((item) => item.data() as AppUser) });
        },
        handleError,
      ),
    );

    unsubs.push(
      onSnapshot(
        collection(db, "sensitiveAccessLogs"),
        (snapshot) => {
          emit({
            accessLogs: sortByUpdatedAt(
              snapshot.docs.map((item) => item.data() as SensitiveAccessLog),
            ),
          });
        },
        handleError,
      ),
    );
  }

  onState(state);
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}
