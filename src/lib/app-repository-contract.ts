import type {
  ActionDeps,
  CreateJoinRequestInput,
  CreatePackageInput,
  CreatePickupLocationInput,
  UpdatePickupLocationInput,
  UpdateArrivalInput,
} from "@/lib/app-state-actions";
import type { AppState } from "@/lib/types";

export type RepositoryStateResult = AppState | void | Promise<AppState | void>;

export interface JoinRequestResult {
  requestId: string;
  state?: AppState;
  recognizedApprovedUser?: boolean;
}

export interface PackageResult {
  packageId: string;
  state?: AppState;
}

export interface PickupLocationResult {
  locationId: string;
  state?: AppState;
}

export type RevealedSensitivePackageDetails = Record<
  string,
  {
    sensitiveDeliveryMessage: string;
    sensitivePickupLink?: string;
    sensitivePackageCode?: string;
  }
>;

export interface PickupRunResult {
  runId: string | null;
  packageCount: number;
  state?: AppState;
  sensitiveDetails?: RevealedSensitivePackageDetails;
}

export interface AppOperationsRepository {
  createJoinRequest(
    state: AppState,
    input: CreateJoinRequestInput,
    deps: ActionDeps,
  ): JoinRequestResult | Promise<JoinRequestResult>;

  createPackage(
    state: AppState,
    input: CreatePackageInput,
    deps: ActionDeps,
  ): PackageResult | Promise<PackageResult>;

  createPickupLocation(
    state: AppState,
    input: CreatePickupLocationInput,
    deps: ActionDeps,
  ): PickupLocationResult | Promise<PickupLocationResult>;

  updatePickupLocation(
    state: AppState,
    input: UpdatePickupLocationInput,
    deps: ActionDeps,
  ): PickupLocationResult | Promise<PickupLocationResult>;

  deletePickupLocation(
    state: AppState,
    locationId: string,
    deps: ActionDeps,
  ): PickupLocationResult | Promise<PickupLocationResult>;

  getWaitingPackageCount(state: AppState, pickupLocationId: string): number | Promise<number>;

  startPickupRun(
    state: AppState,
    pickupLocationId: string,
    deps: ActionDeps,
  ): PickupRunResult | Promise<PickupRunResult>;

  logSensitiveAccess(
    state: AppState,
    input: {
      activeRunId: string;
      packageId: string;
      action: "view_message" | "open_pickup_link";
    },
    deps: ActionDeps,
  ): RepositoryStateResult;

  markPackageCollected(
    state: AppState,
    input: { activeRunId: string | null; packageId: string },
    deps: ActionDeps,
  ): RepositoryStateResult;

  markPackageReceived(state: AppState, packageId: string, deps: ActionDeps): RepositoryStateResult;

  deletePackage(state: AppState, packageId: string, deps: ActionDeps): RepositoryStateResult;

  updateCollectedPackagesArrival(
    state: AppState,
    input: UpdateArrivalInput,
    deps: ActionDeps,
  ): RepositoryStateResult;

  approveJoinRequest(
    state: AppState,
    requestId: string,
    deps: ActionDeps,
  ): RepositoryStateResult;

  rejectJoinRequest(
    state: AppState,
    requestId: string,
    deps: ActionDeps,
  ): RepositoryStateResult;

  promoteUser(state: AppState, userId: string, deps: ActionDeps): RepositoryStateResult;

  blockUser(state: AppState, userId: string, deps: ActionDeps): RepositoryStateResult;
}
