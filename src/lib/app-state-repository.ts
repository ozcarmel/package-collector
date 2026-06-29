import {
  approveJoinRequest,
  createJoinRequest,
  createPackage,
  getWaitingPackageCount,
  logSensitiveAccess,
  markPackageCollected,
  promoteUser,
  rejectJoinRequest,
  startPickupRun,
  updateCollectedPackagesArrival,
} from "@/lib/app-state-actions";
import type { AppOperationsRepository } from "@/lib/app-repository-contract";
import type { AppState } from "@/lib/types";

const storageKey = "lahav-packages-demo-state";
const demoStateVersion = "2026-06-29-pitzutz-opening-hours";

interface StoredDemoState {
  version: string;
  state: AppState;
}

export interface AppStateRepository extends AppOperationsRepository {
  load(): AppState | null;
  save(state: AppState): void;
  clear(): void;
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export const localDemoRepository: AppStateRepository = {
  load() {
    if (!canUseBrowserStorage()) return null;

    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return null;

    try {
      const parsed = JSON.parse(saved) as Partial<StoredDemoState>;
      if (parsed.version === demoStateVersion && parsed.state) {
        return parsed.state;
      }
    } catch {
      // Ignore stale or malformed demo state.
    }

    this.clear();
    return null;
  },

  save(state) {
    if (!canUseBrowserStorage()) return;

    const stored: StoredDemoState = {
      version: demoStateVersion,
      state,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(stored));
  },

  clear() {
    if (!canUseBrowserStorage()) return;
    window.localStorage.removeItem(storageKey);
  },

  createJoinRequest,

  createPackage,

  getWaitingPackageCount,

  startPickupRun,

  logSensitiveAccess,

  markPackageCollected,

  updateCollectedPackagesArrival,

  approveJoinRequest,

  rejectJoinRequest,

  promoteUser,
};
