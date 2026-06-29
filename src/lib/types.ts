export type UserRole = "member" | "admin" | "owner";

export type VerificationStatus =
  | "phone_pending"
  | "admin_pending"
  | "approved"
  | "rejected"
  | "blocked";

export type PackageStatus =
  | "waiting"
  | "assigned"
  | "collected"
  | "arrived"
  | "ready_for_handoff"
  | "delivered"
  | "cancelled";

export type PickupRunStatus = "draft" | "active" | "completed" | "cancelled";

export type PickupRunItemStatus = "pending" | "collected" | "problem" | "skipped";

export type KibbutzDropLocation =
  | "gate-crate"
  | "kolbo"
  | "collector-home"
  | "direct-home"
  | "other";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface OpeningHoursWindow {
  open: string;
  close: string;
}

export type WeeklyOpeningHours = Partial<Record<Weekday, OpeningHoursWindow[]>>;

export interface AppUser {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  verificationStatus: VerificationStatus;
  homeLocation?: string;
  createdAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
  blockedAt?: string;
  blockedByUserId?: string;
}

export interface JoinRequest {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  note?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
}

export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  openingHours: string;
  weeklyHours?: WeeklyOpeningHours;
  navigationUrl: string;
  activeRequests: number;
}

export interface DeliveryPackage {
  id: string;
  ownerUserId: string;
  ownerName: string;
  pickupLocationId: string;
  publicSummary: string;
  status: PackageStatus;
  sensitiveDeliveryMessage?: string;
  sensitivePickupLink?: string;
  sensitivePackageCode?: string;
  parsedCourierCompany?: string;
  parsedAddresseeName?: string;
  parsedTrackingNumber?: string;
  parsedPickupDeadline?: string;
  currentKibbutzLocation?: KibbutzDropLocation;
  currentKibbutzLocationText?: string;
  collectorUserId?: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface PickupRun {
  id: string;
  collectorUserId: string;
  pickupLocationId: string;
  status: PickupRunStatus;
  sensitiveDetailsAccessConfirmedAt?: string;
  createdAt: string;
}

export interface PickupRunItem {
  id: string;
  pickupRunId: string;
  packageId: string;
  itemStatus: PickupRunItemStatus;
  sensitiveMessageViewedAt?: string;
  sensitivePickupLinkOpenedAt?: string;
  pickupProblemText?: string;
  collectedAt?: string;
}

export interface SensitiveAccessLog {
  id: string;
  packageId: string;
  pickupRunId: string;
  viewerUserId: string;
  action: "view_message" | "open_pickup_link";
  createdAt: string;
  ownerUserId?: string;
}

export interface SensitiveAccessGrant {
  id: string;
  packageId: string;
  pickupRunId: string;
  viewerUserId: string;
  pickupLocationId: string;
  createdAt: string;
}

export interface ParsedDeliveryMessage {
  courierCompany?: string;
  messageSender?: string;
  pickupLocationId?: string;
  pickupPlaceName?: string;
  addresseeName?: string;
  trackingNumber?: string;
  packageCode?: string;
  pickupLink?: string;
  pickupDeadline?: string;
  confidence: "low" | "medium" | "high";
}

export interface AppState {
  currentUser: AppUser;
  users: AppUser[];
  joinRequests: JoinRequest[];
  pickupLocations: PickupLocation[];
  packages: DeliveryPackage[];
  pickupRuns: PickupRun[];
  pickupRunItems: PickupRunItem[];
  accessLogs: SensitiveAccessLog[];
}
