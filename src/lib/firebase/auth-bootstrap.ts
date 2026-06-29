import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { initialAppState } from "@/lib/demo-data";
import { getFirebaseAuth, getFirebaseDb, hasFirebaseConfig } from "@/lib/firebase/client";
import type { AppUser } from "@/lib/types";

export interface FirebaseSession {
  authUser: User;
  appUser: AppUser;
}

export type FirebaseSessionListener = (session: FirebaseSession) => void;
export type FirebaseSessionErrorListener = (error: Error) => void;

function newPendingUser(authUser: User): AppUser {
  return {
    id: authUser.uid,
    fullName: authUser.displayName ?? "",
    phone: authUser.phoneNumber ?? "",
    role: "member",
    verificationStatus: "phone_pending",
    createdAt: new Date().toISOString(),
  };
}

async function ensureUserDocument(authUser: User) {
  const db = getFirebaseDb();
  if (!db) return newPendingUser(authUser);

  const userRef = doc(db, "users", authUser.uid);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) {
    return snapshot.data() as AppUser;
  }

  const fallbackUser = initialAppState.users.find((user) => user.id === authUser.uid);
  const user = fallbackUser ?? newPendingUser(authUser);
  await setDoc(userRef, user);
  return user;
}

export function subscribeFirebaseSession(
  onSession: FirebaseSessionListener,
  onError: FirebaseSessionErrorListener,
) {
  const auth = getFirebaseAuth();
  if (!hasFirebaseConfig() || !auth) return null;

  const unsubscribe = onAuthStateChanged(
    auth,
    async (authUser) => {
      try {
        const user = authUser ?? (await signInAnonymously(auth)).user;
        const appUser = await ensureUserDocument(user);
        onSession({ authUser: user, appUser });
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    (error) => onError(error),
  );

  return unsubscribe;
}
