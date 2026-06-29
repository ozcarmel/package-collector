import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import type { PickupRun, PickupRunItem } from "@/lib/types";

export interface SecurePackageCreateInput {
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

export interface SecurePickupRevealInput {
  pickupRunId: string;
  packageIds: string[];
}

export interface SecurePickupRunInput {
  pickupLocationId: string;
}

export interface SecurePackageCollectedInput {
  pickupRunId: string;
  packageId: string;
}

export interface SecurePackageCollectedResult {
  packageId: string;
  pickupRunId: string;
  collectedAt: string;
}

export type RevealedSensitiveDetails = Record<
  string,
  {
    sensitiveDeliveryMessage: string;
    sensitivePickupLink?: string;
    sensitivePackageCode?: string;
  }
>;

export interface SecurePickupRunResult {
  runId: string | null;
  packageCount: number;
  run?: PickupRun;
  items?: PickupRunItem[];
  sensitiveDetails?: RevealedSensitiveDetails;
}

function requireFunctions() {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new Error("Firebase Functions is not configured.");
  }
  return functions;
}

export async function createPackageWithSensitiveDetails(input: SecurePackageCreateInput) {
  const callable = httpsCallable<SecurePackageCreateInput, { packageId: string }>(
    requireFunctions(),
    "createPackageWithSensitiveDetails",
  );
  const result = await callable(input);
  return result.data;
}

export async function revealSensitiveDetailsForPickupRun(input: SecurePickupRevealInput) {
  const callable = httpsCallable<
    SecurePickupRevealInput,
    RevealedSensitiveDetails
  >(requireFunctions(), "revealSensitiveDetailsForPickupRun");
  const result = await callable(input);
  return result.data;
}

export async function startSecurePickupRun(input: SecurePickupRunInput) {
  const callable = httpsCallable<SecurePickupRunInput, SecurePickupRunResult>(
    requireFunctions(),
    "startSecurePickupRun",
  );
  const result = await callable(input);
  return result.data;
}

export async function markPackageCollectedSecurely(input: SecurePackageCollectedInput) {
  const callable = httpsCallable<SecurePackageCollectedInput, SecurePackageCollectedResult>(
    requireFunctions(),
    "markPackageCollectedSecurely",
  );
  const result = await callable(input);
  return result.data;
}
