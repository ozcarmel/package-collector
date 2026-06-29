import type { AppOperationsRepository } from "@/lib/app-repository-contract";
import { localDemoRepository } from "@/lib/app-state-repository";
import { hasFirebaseConfig } from "@/lib/firebase/client";
import { firestoreRepository } from "@/lib/firebase/firestore-repository";

export function getConfiguredOperationsRepository(): AppOperationsRepository {
  return hasFirebaseConfig() ? firestoreRepository : localDemoRepository;
}

export { localDemoRepository };
