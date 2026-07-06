"use client";

import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  ClipboardList,
  Copy,
  Home,
  Info,
  Mail,
  MapPin,
  MapPinCheck,
  Package,
  Pencil,
  Phone,
  PlusCircle,
  Route,
  Save,
  Send,
  Settings,
  ShieldCheck,
  ShieldPlus,
  Trash2,
  Truck,
  User,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getConfiguredOperationsRepository } from "@/lib/app-repository";
import type { RevealedSensitivePackageDetails } from "@/lib/app-repository-contract";
import {
  createId,
  getEquivalentUserIdsForCurrentUser,
  kibbutzDropLocationDefaultNotes,
} from "@/lib/app-state-actions";
import { localDemoRepository } from "@/lib/app-state-repository";
import { initialAppState } from "@/lib/demo-data";
import { subscribeFirestoreAppState } from "@/lib/firebase/app-state-subscriptions";
import { subscribeFirebaseSession } from "@/lib/firebase/auth-bootstrap";
import { hasFirebaseConfig } from "@/lib/firebase/client";
import {
  isOzAdminShortcut,
  isOzSuperAdminUser,
  normalizePhone,
} from "@/lib/oz-admin-shortcut";
import {
  getUserAddedPackages,
  shouldShowPackageInAdminList,
  shouldShowPackageOnHome,
} from "@/lib/home-package-visibility";
import { getPickupLocationOpenState } from "@/lib/pickup-location-hours";
import { normalizePickupLocationSchedules } from "@/lib/pickup-location-schedule-defaults";
import type {
  AppState,
  DeliveryPackage,
  KibbutzDropLocation,
  PackageStatus,
  PickupLocation,
  Weekday,
  WeeklyOpeningHours,
} from "@/lib/types";

type Screen =
  | "join"
  | "pending"
  | "home"
  | "add"
  | "pickup"
  | "catalog"
  | "arrival"
  | "admin";

type EffectiveScreen = Screen | "loading";

type AdminListView = "pending" | "approved" | "managers" | "packages";
type HomePackageStatusBucket = "waiting" | "collected" | "arrived" | "delivered";

const homeStatusBucketLabels: Record<HomePackageStatusBucket, string> = {
  waiting: "ממתינות לאיסוף",
  collected: "נאספו",
  arrived: "נמסרו בקיבוץ",
  delivered: "נתקבלו",
};

interface DraftPackage {
  ownerName: string;
  pickupLocationId: string;
  sensitiveDeliveryMessage: string;
}

interface JoinDraft {
  fullName: string;
  phone: string;
  note: string;
}

interface LocationDayDraft {
  enabled: boolean;
  firstOpen: string;
  firstClose: string;
  secondEnabled: boolean;
  secondOpen: string;
  secondClose: string;
}

interface LocationDraft {
  name: string;
  address: string;
  openingHours: string;
  weeklyHours: Record<Weekday, LocationDayDraft>;
}

interface ArrivalPackageDraft {
  dropLocation: KibbutzDropLocation;
  dropNote: string;
}

interface UnlockAnchor {
  top: number;
  left: number;
  width: number;
}

interface NavItem {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  screen: Screen;
}

const appName = "חבילות להב";

const emptyDraft: DraftPackage = {
  ownerName: "",
  pickupLocationId: "pitzutz",
  sensitiveDeliveryMessage: "",
};

const packageOwnerExample = "עוז כרמל";
const deliveryMessageExample =
  "הדביקו כאן במלואה את ההודעה שקיבלתם ב-SMS או במייל, כולל קוד וקישור. ההודעה שמורה בצורה מאובטחת ורק מי שאוסף יוכל לראות אותה.";
const urlPattern = /(https?:\/\/[^\s]+)/g;
const fullUrlPattern = /^https?:\/\/[^\s]+$/;
const dropNoteExamples = kibbutzDropLocationDefaultNotes;

const initialJoinDraft: JoinDraft = {
  fullName: "",
  phone: "",
  note: "היי, אני חבר/ת להב. אפשר לאשר אותי?",
};

const firebaseBootstrapUser: AppState["currentUser"] = {
  id: "firebase-bootstrap",
  fullName: "",
  phone: "",
  role: "member",
  verificationStatus: "phone_pending",
  createdAt: "",
};

function getInitialRuntimeState(): AppState {
  if (!hasFirebaseConfig()) {
    return normalizePickupLocationSchedules(initialAppState);
  }

  return normalizePickupLocationSchedules({
    ...initialAppState,
    currentUser: firebaseBootstrapUser,
    users: [firebaseBootstrapUser],
    joinRequests: [],
    packages: [],
    pickupRuns: [],
    pickupRunItems: [],
    accessLogs: [],
  });
}

const weekdayLabels: Array<[Weekday, string]> = [
  [0, "א׳"],
  [1, "ב׳"],
  [2, "ג׳"],
  [3, "ד׳"],
  [4, "ה׳"],
  [5, "ו׳"],
  [6, "שבת"],
];

const emptyLocationDayDraft: LocationDayDraft = {
  enabled: false,
  firstOpen: "08:00",
  firstClose: "13:00",
  secondEnabled: false,
  secondOpen: "18:00",
  secondClose: "21:00",
};

function createEmptyLocationDraft(): LocationDraft {
  return {
    name: "",
    address: "",
    openingHours: "",
    weeklyHours: weekdayLabels.reduce(
      (days, [day]) => ({
        ...days,
        [day]: { ...emptyLocationDayDraft },
      }),
      {} as Record<Weekday, LocationDayDraft>,
    ),
  };
}

function createLocationDraftFromLocation(location: PickupLocation): LocationDraft {
  const draft = createEmptyLocationDraft();

  for (const [day] of weekdayLabels) {
    const windows = location.weeklyHours?.[day] ?? [];
    const firstWindow = windows[0];
    const secondWindow = windows[1];

    draft.weeklyHours[day] = {
      enabled: windows.length > 0,
      firstOpen: firstWindow?.open ?? emptyLocationDayDraft.firstOpen,
      firstClose: firstWindow?.close ?? emptyLocationDayDraft.firstClose,
      secondEnabled: Boolean(secondWindow),
      secondOpen: secondWindow?.open ?? emptyLocationDayDraft.secondOpen,
      secondClose: secondWindow?.close ?? emptyLocationDayDraft.secondClose,
    };
  }

  return {
    ...draft,
    name: location.name,
    address: location.address,
    openingHours: location.openingHours,
  };
}

function hasJoinPreviewParam() {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  return params.get("freshUser") === "1" || params.get("joinPreview") === "1";
}

function statusLabel(status: PackageStatus) {
  switch (status) {
    case "waiting":
      return "ממתינה לאיסוף";
    case "assigned":
      return "ממתינה לאיסוף";
    case "collected":
      return "נאספה";
    case "arrived":
      return "נמסרה בקיבוץ";
    case "ready_for_handoff":
      return "נמסרה בקיבוץ";
    case "delivered":
      return "נתקבלה";
    case "cancelled":
      return "בוטלה";
  }
}

function pickupLocationDisplayName(location: PickupLocation) {
  if (location.id === "home-paami" || location.name === "הום פעמי להבים") {
    return "הום פעמי";
  }

  if (location.id === "deli-place" || location.name === "דלי פלייס להבים") {
    return "דלי פלייס";
  }

  return location.name;
}

const openingHoursDayNames = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];

function openingHoursDayLabel(day: Weekday) {
  return day === 6 ? "שבת" : `${openingHoursDayNames[day]}'`;
}

function openingHoursRangeLabel(start: Weekday, end: Weekday) {
  if (start === end) return openingHoursDayLabel(start);
  return `${openingHoursDayLabel(start)}-${openingHoursDayLabel(end)}`;
}

function openingHoursWindowText(windows: WeeklyOpeningHours[Weekday] = []) {
  if (windows.length === 0) return "סגור";
  return windows.map((window) => `${window.open}-${window.close}`).join(", ");
}

function openingHoursRows(location: PickupLocation) {
  if (!location.weeklyHours) {
    return [{ days: "", hours: location.openingHours }];
  }

  const configuredDays = weekdayLabels
    .map(([day]) => day)
    .filter((day) => Object.prototype.hasOwnProperty.call(location.weeklyHours, day));

  if (configuredDays.length === 0) {
    return [{ days: "", hours: location.openingHours }];
  }

  const rows: Array<{ days: string; hours: string }> = [];
  let rangeStart = configuredDays[0];
  let rangeEnd = configuredDays[0];
  let previousText = openingHoursWindowText(location.weeklyHours[rangeStart]);

  for (const currentDay of configuredDays.slice(1)) {
    const currentText = openingHoursWindowText(location.weeklyHours[currentDay]);
    const crossesIntoFriday = rangeEnd === 4 && currentDay === 5;
    if (currentText === previousText && currentDay === rangeEnd + 1 && !crossesIntoFriday) {
      rangeEnd = currentDay;
      continue;
    }

    rows.push({
      days: openingHoursRangeLabel(rangeStart, rangeEnd),
      hours: previousText,
    });
    rangeStart = currentDay;
    rangeEnd = currentDay;
    previousText = currentText;
  }

  rows.push({
    days: openingHoursRangeLabel(rangeStart, rangeEnd),
    hours: previousText,
  });

  return rows;
}

function statusBadgeClass(status: PackageStatus) {
  if (status === "collected") return "badge blue";
  if (status === "arrived" || status === "ready_for_handoff") return "badge arrived";
  if (status === "delivered") return "badge delivered";
  if (status === "cancelled") return "badge danger";
  return "badge waiting";
}

function getHomePackageStatusBucket(status: PackageStatus): HomePackageStatusBucket | null {
  switch (status) {
    case "waiting":
    case "assigned":
      return "waiting";
    case "collected":
      return "collected";
    case "arrived":
    case "ready_for_handoff":
      return "arrived";
    case "delivered":
      return "delivered";
    case "cancelled":
      return null;
  }
}

function homePackageStatusLabel(pkg: DeliveryPackage) {
  const bucket = getHomePackageStatusBucket(pkg.status);

  switch (bucket) {
    case "waiting":
      return "ממתינה לאיסוף";
    case "collected":
      return "נאספה";
    case "arrived":
      return "נמסרה בקיבוץ";
    case "delivered":
      return "נתקבלה";
    case null:
      return statusLabel(pkg.status);
  }
}

function homePackageStatusBadgeClass(pkg: DeliveryPackage) {
  const bucket = getHomePackageStatusBucket(pkg.status);

  switch (bucket) {
    case "waiting":
      return "badge waiting";
    case "collected":
      return "badge blue";
    case "arrived":
      return "badge arrived";
    case "delivered":
      return "badge delivered";
    case null:
      return statusBadgeClass(pkg.status);
  }
}

function homePackageDetailBadge(pkg: DeliveryPackage) {
  const bucket = getHomePackageStatusBucket(pkg.status);

  switch (bucket) {
    case "waiting":
      return null;
    case "collected":
      return null;
    case "arrived":
      return {
        className: "package-detail-note",
        icon: null,
        text:
          pkg.currentKibbutzLocationText?.trim() ||
          (pkg.currentKibbutzLocation ? dropNoteExamples[pkg.currentKibbutzLocation] : "") ||
          "מיקום בקיבוץ לא צוין",
      };
    case "delivered":
      return null;
    case null:
      return {
        className: statusBadgeClass(pkg.status),
        icon: null,
        text: statusLabel(pkg.status),
      };
  }
}

function getLocationName(locations: PickupLocation[], id: string) {
  return locations.find((location) => location.id === id)?.name ?? "נקודה לא ידועה";
}

function getUserName(users: AppState["users"], id?: string) {
  return id ? users.find((user) => user.id === id)?.fullName : undefined;
}

function dedupeUsersByPhone(users: AppState["users"], preferredUserId: string) {
  const grouped = new Map<string, AppState["users"][number]>();

  for (const user of users) {
    const normalizedPhone = normalizePhone(user.phone);
    const key = normalizedPhone || user.id;
    const existing = grouped.get(key);

    if (!existing || user.id === preferredUserId) {
      grouped.set(key, user);
    }
  }

  return [...grouped.values()];
}

function unapprovedAccessMessage(screen: Screen) {
  if (screen === "add") {
    return "לא ניתן להוסיף חבילה לפני אישור משתמש חדש";
  }

  if (screen === "pickup" || screen === "catalog" || screen === "arrival") {
    return "לא ניתן לאסוף חבילה לפני אישור משתמש חדש";
  }

  return null;
}

function formatHebrewDate(isoDate?: string) {
  if (!isoDate) return "";

  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(isoDate));
}

function formatHebrewDateTime(isoDate?: string) {
  if (!isoDate) return "";

  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(isoDate));
}

function extractMessageUrls(message: string) {
  return [...message.matchAll(urlPattern)].map((match) => match[0].replace(/[.,;:!?]+$/u, ""));
}

export function LahavPackagesApp() {
  const [state, setState] = useState<AppState>(() => getInitialRuntimeState());
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [isSubmittingJoinRequest, setIsSubmittingJoinRequest] = useState(false);
  const [isSavingPackage, setIsSavingPackage] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [highlightedPackage, setHighlightedPackage] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isStartingPickupRun, setIsStartingPickupRun] = useState(false);
  const [collectingPackageId, setCollectingPackageId] = useState<string | null>(null);
  const [receivingPackageId, setReceivingPackageId] = useState<string | null>(null);
  const [savingArrivalPackageId, setSavingArrivalPackageId] = useState<string | null>(null);
  const [adminActionId, setAdminActionId] = useState<string | null>(null);
  const [adminListView, setAdminListView] = useState<AdminListView>("pending");
  const [isAddLocationModalOpen, setIsAddLocationModalOpen] = useState(false);
  const [isHomeHelpOpen, setIsHomeHelpOpen] = useState(false);
  const [activeStatusSheet, setActiveStatusSheet] = useState<HomePackageStatusBucket | null>(
    null,
  );
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [pendingDeleteLocationId, setPendingDeleteLocationId] = useState<string | null>(null);
  const [pendingDeletePackageId, setPendingDeletePackageId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(() => (hasJoinPreviewParam() ? "join" : "home"));
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPackage>(emptyDraft);
  const [joinDraft, setJoinDraft] = useState<JoinDraft>(initialJoinDraft);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(() =>
    createEmptyLocationDraft(),
  );
  const [submittedJoinRequestId, setSubmittedJoinRequestId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [revealedSensitiveDetails, setRevealedSensitiveDetails] =
    useState<RevealedSensitivePackageDetails>({});
  const [pendingUnlockLocationId, setPendingUnlockLocationId] = useState<string | null>(null);
  const [hoursLocationId, setHoursLocationId] = useState<string | null>(null);
  const [pendingUnlockAnchor, setPendingUnlockAnchor] = useState<UnlockAnchor | null>(null);
  const [homeLocationFilterId, setHomeLocationFilterId] = useState<string | null>(null);
  const [joinPreviewMode, setJoinPreviewMode] = useState(() => hasJoinPreviewParam());
  const [arrivalDraftsByPackageId, setArrivalDraftsByPackageId] = useState<
    Record<string, ArrivalPackageDraft>
  >({});
  const [expandedArrivalPackageIds, setExpandedArrivalPackageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openedPickupLinkPackageIds, setOpenedPickupLinkPackageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pickupLocationStripRef = useRef<HTMLDivElement | null>(null);
  const pickupLocationArrowRef = useRef<HTMLButtonElement | null>(null);
  const addPackageFormRef = useRef<HTMLFormElement | null>(null);
  const packageOwnerInputRef = useRef<HTMLInputElement | null>(null);
  const ozPendingRecoveryRef = useRef<string | null>(null);
  const pendingCreatedPackageIdsRef = useRef<Set<string>>(new Set());
  const firebaseEnabled = hasFirebaseConfig();
  const currentUser = state.currentUser;
  const isFirebaseBootstrapUser = currentUser.id === firebaseBootstrapUser.id;
  const isJoinSubmissionReady = !firebaseEnabled || (repositoryReady && !isFirebaseBootstrapUser);
  const currentUserId = currentUser.id;
  const currentUserRole = currentUser.role;
  const currentUserVerificationStatus = currentUser.verificationStatus;
  const subscriptionUser = useMemo(
    () => ({
      id: currentUserId,
      fullName: "",
      phone: "",
      role: currentUserRole,
      verificationStatus: currentUserVerificationStatus,
      createdAt: "",
    }),
    [
      currentUserId,
      currentUserRole,
      currentUserVerificationStatus,
    ],
  );

  useEffect(() => {
    function refreshCurrentTime() {
      setCurrentTimeMs(Date.now());
    }

    refreshCurrentTime();
    const intervalId = window.setInterval(refreshCurrentTime, 30 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!highlightedPackage) return undefined;

    const timeoutId = window.setTimeout(() => setHighlightedPackage(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [highlightedPackage]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const shouldPreviewJoin = url.searchParams.get("joinPreview") === "1";

    if (!shouldPreviewJoin) return;

    url.searchParams.delete("joinPreview");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (firebaseEnabled) {
      const unsubscribe = subscribeFirebaseSession(
        ({ appUser }) => {
          setState((current) => {
            const existingUser = current.users.find((user) => user.id === appUser.id);
            const currentUserUnchanged =
              current.currentUser.id === appUser.id &&
              current.currentUser.fullName === appUser.fullName &&
              current.currentUser.phone === appUser.phone &&
              current.currentUser.role === appUser.role &&
              current.currentUser.verificationStatus === appUser.verificationStatus;
            const existingUserUnchanged =
              existingUser?.fullName === appUser.fullName &&
              existingUser.phone === appUser.phone &&
              existingUser.role === appUser.role &&
              existingUser.verificationStatus === appUser.verificationStatus;

            if (currentUserUnchanged && existingUserUnchanged) {
              return current;
            }

            return {
              ...current,
              currentUser: appUser,
              users: [appUser, ...current.users.filter((user) => user.id !== appUser.id)],
            };
          });
          setRepositoryReady(true);
        },
        () => setToast("לא הצלחנו להתחבר ל-Firebase. בדוק/י את ההגדרות ונסה/י שוב."),
      );
      return () => unsubscribe?.();
    }

    const timeout = window.setTimeout(() => {
      const savedState = localDemoRepository.load();
      if (savedState) setState(normalizePickupLocationSchedules(savedState));
      setRepositoryReady(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [firebaseEnabled]);

  useEffect(() => {
    if (!repositoryReady || firebaseEnabled) return;
    localDemoRepository.save(state);
  }, [firebaseEnabled, repositoryReady, state]);

  useEffect(() => {
    if (!firebaseEnabled || !repositoryReady) return;

    const unsubscribe = subscribeFirestoreAppState(
      subscriptionUser,
      (nextState) =>
        setState((currentState) =>
          normalizePickupLocationSchedules(mergePendingCreatedPackages(currentState, nextState)),
        ),
      () => setToast("לא הצלחנו לקבל עדכונים חיים מ-Firebase."),
    );

    return () => unsubscribe?.();
  }, [
    firebaseEnabled,
    repositoryReady,
    subscriptionUser,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!pendingUnlockLocationId) return;

    function closeUnlockPopupWhenSwitchingLocations(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      const locationCard = target?.closest<HTMLElement>("[data-pickup-location-id]");

      if (!locationCard) return;

      if (locationCard.dataset.pickupLocationId !== pendingUnlockLocationId) {
        setPendingUnlockLocationId(null);
        setPendingUnlockAnchor(null);
      }
    }

    document.addEventListener("pointerdown", closeUnlockPopupWhenSwitchingLocations, true);
    return () =>
      document.removeEventListener("pointerdown", closeUnlockPopupWhenSwitchingLocations, true);
  }, [pendingUnlockLocationId]);

  const activeHomePackages = state.packages.filter(
    (pkg) =>
      getHomePackageStatusBucket(pkg.status) !== null && shouldShowPackageOnHome(pkg, currentTimeMs),
  );
  const waitingPackages = activeHomePackages.filter(
    (pkg) => getHomePackageStatusBucket(pkg.status) === "waiting",
  );
  const firstWaitingPickupLocationId =
    state.pickupLocations.find((location) =>
      state.packages.some(
        (pkg) => pkg.pickupLocationId === location.id && pkg.status === "waiting",
      ),
    )?.id ?? null;
  const collectedPackages = activeHomePackages.filter(
    (pkg) => getHomePackageStatusBucket(pkg.status) === "collected",
  );
  const currentEquivalentUserIds = getEquivalentUserIdsForCurrentUser(state);
  const currentUserCollectedPackages = collectedPackages.filter(
    (pkg) => pkg.collectorUserId && currentEquivalentUserIds.has(pkg.collectorUserId),
  );
  const arrivedPackages = activeHomePackages.filter(
    (pkg) => getHomePackageStatusBucket(pkg.status) === "arrived",
  );
  const deliveredPackages = activeHomePackages.filter(
    (pkg) => getHomePackageStatusBucket(pkg.status) === "delivered",
  );
  const statusSheetPackages =
    activeStatusSheet === "waiting"
      ? waitingPackages
      : activeStatusSheet === "collected"
        ? collectedPackages
        : activeStatusSheet === "arrived"
          ? arrivedPackages
          : activeStatusSheet === "delivered"
            ? deliveredPackages
            : [];
  const visibleHomePackages = activeHomePackages.filter(
    (pkg) => getHomePackageStatusBucket(pkg.status) !== null,
  );
  const effectiveDraftPickupLocationId = state.pickupLocations.some(
    (location) => location.id === draft.pickupLocationId,
  )
    ? draft.pickupLocationId
    : state.pickupLocations[0]?.id ?? "";
  const draftMessageUrls = extractMessageUrls(draft.sensitiveDeliveryMessage);
  const isPackageDraftReady =
    Boolean(draft.ownerName.trim()) &&
    Boolean(draft.sensitiveDeliveryMessage.trim()) &&
    Boolean(effectiveDraftPickupLocationId) &&
    Boolean(state.pickupLocations.length);
  const packageActionLabel = editingPackageId ? "עדכן פרטים" : "הוסף חבילה";
  const userAddedPackages = getUserAddedPackages(state.packages, currentUserId);
  const activeRun = state.pickupRuns.find((run) => run.id === activeRunId);
  const activeRunItems = state.pickupRunItems.filter(
    (item) => item.pickupRunId === activeRunId,
  );
  const activeRunPackageIds = new Set(activeRunItems.map((item) => item.packageId));
  const catalogPackages = activeRun
    ? state.packages
        .filter((pkg) => activeRunPackageIds.has(pkg.id))
        .map((pkg) => ({ ...pkg, ...revealedSensitiveDetails[pkg.id] }))
    : [];

  const activeLocation = activeRun
    ? state.pickupLocations.find((location) => location.id === activeRun.pickupLocationId)
    : null;
  const pendingUnlockLocation = pendingUnlockLocationId
    ? state.pickupLocations.find((location) => location.id === pendingUnlockLocationId)
    : null;
  const hoursLocation = hoursLocationId
    ? state.pickupLocations.find((location) => location.id === hoursLocationId)
    : null;
  const pendingDeleteLocation = pendingDeleteLocationId
    ? state.pickupLocations.find((location) => location.id === pendingDeleteLocationId)
    : null;
  const pendingDeletePackage = pendingDeletePackageId
    ? state.packages.find((pkg) => pkg.id === pendingDeletePackageId)
    : null;
  const editingLocation = editingLocationId
    ? state.pickupLocations.find((location) => location.id === editingLocationId)
    : null;

  const pendingJoinRequests = state.joinRequests.filter(
    (request) =>
      request.status === "pending" &&
      !(
        isOzAdminShortcut(request) &&
        request.userId === currentUserId &&
        (currentUser.role === "admin" || currentUser.role === "owner")
      ),
  );
  const ownPendingJoinRequest = pendingJoinRequests.find(
    (request) => request.userId === currentUserId,
  );
  const submittedJoinRequest =
    state.joinRequests.find(
      (request) => request.id === submittedJoinRequestId && request.userId === currentUserId,
    ) ?? ownPendingJoinRequest;
  const isApprovedUser =
    !joinPreviewMode && currentUser.verificationStatus === "approved";
  const canManageCommunity =
    isApprovedUser && (currentUser.role === "admin" || currentUser.role === "owner");
  const canOpenArrivalScreen = isApprovedUser;
  const isResolvingFirebaseSession = firebaseEnabled && !repositoryReady && !joinPreviewMode;
  const requestedScreenAccessMessage = isApprovedUser ? null : unapprovedAccessMessage(screen);
  const effectiveScreen: EffectiveScreen = isResolvingFirebaseSession
    ? "loading"
    : screen === "pending" && submittedJoinRequest?.status === "approved"
      ? "home"
      : screen === "home" && !isApprovedUser
        ? submittedJoinRequest
          ? "pending"
          : "join"
      : screen === "admin" && !canManageCommunity
        ? "home"
        : requestedScreenAccessMessage
          ? submittedJoinRequest
            ? "pending"
            : "join"
        : screen === "arrival" && !isApprovedUser
          ? "home"
          : screen;

  const navItems: NavItem[] = [
    { screen: "home", label: "בית", icon: <Home /> },
    { screen: "add", label: "הוספה", icon: <PlusCircle /> },
    { screen: "pickup", label: "איסוף", icon: <Route /> },
    {
      screen: "arrival",
      label: "מסירה",
      disabled: !canOpenArrivalScreen,
      icon: (
        <span className="nav-icon-with-badge">
          <MapPinCheck />
          {currentUserCollectedPackages.length ? (
            <span className="nav-badge">{currentUserCollectedPackages.length}</span>
          ) : null}
        </span>
      ),
    },
  ];
  const headerConfig = getHeaderConfig();
  const operationsRepository = getConfiguredOperationsRepository();
  const actionDeps = useMemo(
    () => ({
      createId,
      now: () => new Date().toISOString(),
    }),
    [],
  );

  useEffect(() => {
    if (!repositoryReady || canManageCommunity || !submittedJoinRequest) return;
    if (!isOzAdminShortcut(submittedJoinRequest)) return;
    if (submittedJoinRequest.status !== "pending") return;
    if (submittedJoinRequest.userId !== currentUserId) return;

    const recoveryKey = `${currentUserId}:${submittedJoinRequest.id}`;
    if (ozPendingRecoveryRef.current === recoveryKey) return;
    ozPendingRecoveryRef.current = recoveryKey;

    void (async () => {
      try {
        const result = await operationsRepository.createJoinRequest(
          state,
          {
            fullName: submittedJoinRequest.fullName,
            phone: submittedJoinRequest.phone,
            note: submittedJoinRequest.note,
          },
          actionDeps,
        );
        if (result.state) {
          setState(normalizePickupLocationSchedules(result.state));
        }
        setSubmittedJoinRequestId(null);
        setJoinPreviewMode(false);
        setScreen("home");
        notify("זוהית כמנהל. הרשאת הניהול פעילה.");
      } catch {
        notify("לא הצלחנו להפעיל הרשאת מנהל. בדוק/י את מספר הטלפון ונסה/י שוב.");
      }
    })();
  }, [
    actionDeps,
    canManageCommunity,
    currentUserId,
    operationsRepository,
    repositoryReady,
    state,
    submittedJoinRequest,
  ]);

  const pendingUnlockStyle: CSSProperties | undefined = pendingUnlockAnchor
    ? {
        top: pendingUnlockAnchor.top,
        left: pendingUnlockAnchor.left,
        width: pendingUnlockAnchor.width,
      }
    : undefined;

  function notify(message: string) {
    setToast(message);
  }

  function statusSheetPackageMeta(pkg: DeliveryPackage) {
    const pickupLocation = getLocationName(state.pickupLocations, pkg.pickupLocationId);
    const collectorName = getUserName(state.users, pkg.collectorUserId);
    const bucket = getHomePackageStatusBucket(pkg.status);

    switch (bucket) {
      case "waiting":
        return pickupLocation;
      case "collected":
        return collectorName ? `נאספה על ידי ${collectorName}` : pickupLocation;
      case "arrived":
        return pkg.currentKibbutzLocationText?.trim() || "נמסרה בקיבוץ";
      case "delivered":
        return pickupLocation;
      case null:
        return pickupLocation;
    }
  }

  function navigateToScreen(nextScreen: Screen) {
    const accessMessage = isApprovedUser ? null : unapprovedAccessMessage(nextScreen);
    if (accessMessage) {
      notify(accessMessage);
      setScreen(submittedJoinRequest ? "pending" : "join");
      return;
    }

    if (nextScreen === "pickup") {
      setPendingUnlockLocationId(null);
      setPendingUnlockAnchor(null);
      setHomeLocationFilterId(firstWaitingPickupLocationId);
    }

    setScreen(nextScreen);
  }

  function getUnlockAnchor(target: HTMLElement): UnlockAnchor {
    const rect = target.getBoundingClientRect();
    const appRect =
      target.closest(".app-view")?.getBoundingClientRect() ??
      target.closest(".phone-frame")?.getBoundingClientRect();
    const bounds = appRect ?? {
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const margin = 14;
    const availableWidth = Math.max(240, bounds.width - margin * 2);
    const preferredWidth = Math.min(360, Math.max(300, rect.width));
    const width = Math.min(preferredWidth, availableWidth);
    const targetCenter = rect.left + rect.width / 2;
    const minLeft = bounds.left + margin;
    const maxLeft = bounds.right - width - margin;
    const left = Math.min(Math.max(minLeft, targetCenter - width / 2), maxLeft);
    const preferredTop = rect.bottom + 8;
    const minTop = bounds.top + margin;
    const maxTop = Math.max(minTop, bounds.bottom - 230);
    const top = Math.min(Math.max(minTop, preferredTop), maxTop);

    return { top, left, width };
  }

  function scrollPickupLocations() {
    const strip = pickupLocationStripRef.current;
    if (!strip) return;

    const distance = Math.max(160, Math.floor(strip.clientWidth * 0.72));
    const before = strip.scrollLeft;
    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const currentOffset = Math.min(maxScroll, Math.abs(before));
    const endThreshold = Math.max(8, Math.min(90, Math.floor(strip.clientWidth * 0.25)));
    const targetOffset =
      pickupLocationArrowRef.current?.dataset.atEnd === "true" ||
      currentOffset >= maxScroll - endThreshold
        ? 0
        : Math.min(maxScroll, currentOffset + distance);

    strip.scrollTo({ left: -targetOffset, behavior: "smooth" });

    window.setTimeout(() => {
      if (Math.abs(strip.scrollLeft - before) <= 2) {
        strip.scrollTo({ left: targetOffset, behavior: "smooth" });
      }
      setPickupStripArrowDirection(targetOffset >= maxScroll - endThreshold);
    }, 220);
  }

  function updatePickupStripDirection() {
    const strip = pickupLocationStripRef.current;
    if (!strip) return;

    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const endThreshold = Math.max(8, Math.min(90, Math.floor(strip.clientWidth * 0.25)));
    setPickupStripArrowDirection(Math.abs(strip.scrollLeft) >= maxScroll - endThreshold);
  }

  function setPickupStripArrowDirection(isAtEnd: boolean) {
    const arrow = pickupLocationArrowRef.current;
    if (!arrow) return;

    arrow.dataset.atEnd = String(isAtEnd);
    arrow.setAttribute(
      "aria-label",
      isAtEnd ? "חזור לתחילת מיקומי האיסוף" : "הצג עוד מיקומי איסוף",
    );
  }

  function getHeaderConfig(): {
    title: string;
    subtitle?: ReactNode;
    backTarget?: Screen;
    showBell?: boolean;
    showAdmin?: boolean;
    showMark?: boolean;
  } {
    switch (effectiveScreen) {
      case "loading":
        return {
          title: appName,
          showMark: true,
        };
      case "home":
        return {
          title: appName,
          showAdmin: canManageCommunity,
          showBell: !canManageCommunity,
          showMark: true,
        };
      case "add":
        return { title: "הוספת חבילה", backTarget: "home" };
      case "pickup":
        return { title: "אני נוסע לאסוף", backTarget: "home" };
      case "catalog":
        return {
          title: "איסוף בחנות",
          subtitle: (
            <>
              {activeLocation?.name ?? "נקודת איסוף"} <MapPin />
            </>
          ),
          backTarget: "pickup",
        };
      case "arrival":
        return { title: "מסירה בקיבוץ", backTarget: "home" };
      case "admin":
        return { title: "ניהול קהילה", backTarget: "home" };
      case "join":
        return { title: "הצטרפות לחבילות להב", backTarget: "home", showMark: true };
      case "pending":
        return { title: "הצטרפות לחבילות להב", backTarget: "join", showMark: true };
    }
  }

  async function requestPickupUnlock(locationId: string, target?: HTMLElement) {
    if (!isApprovedUser) {
      notify("לא ניתן לאסוף חבילה לפני אישור משתמש חדש");
      setScreen(submittedJoinRequest ? "pending" : "join");
      return;
    }

    try {
      const waitingCount = await operationsRepository.getWaitingPackageCount(state, locationId);

      if (waitingCount === 0) {
        setPendingUnlockLocationId(null);
        setPendingUnlockAnchor(null);
        notify("אין כרגע חבילות שממתינות לאיסוף בנקודה הזאת.");
        return;
      }

      setHomeLocationFilterId(locationId);
      setPendingUnlockAnchor(target ? getUnlockAnchor(target) : null);
      setPendingUnlockLocationId(locationId);
    } catch {
      notify("לא הצלחנו לבדוק כמה חבילות ממתינות בנקודה הזאת.");
    }
  }

  async function confirmPickupUnlock() {
    if (!pendingUnlockLocationId) return;
    const locationId = pendingUnlockLocationId;
    setPendingUnlockLocationId(null);
    setPendingUnlockAnchor(null);
    await startPickupRun(locationId);
  }

  function cancelPickupUnlock() {
    setPendingUnlockLocationId(null);
    setPendingUnlockAnchor(null);
  }

  function openPickupScreenForLocation(locationId: string) {
    if (!isApprovedUser) {
      notify("לא ניתן לאסוף חבילה לפני אישור משתמש חדש");
      setScreen(submittedJoinRequest ? "pending" : "join");
      return;
    }

    setPendingUnlockLocationId(null);
    setPendingUnlockAnchor(null);
    setHomeLocationFilterId(locationId);
    setScreen("pickup");
  }

  async function submitJoinRequest() {
    const fullName = joinDraft.fullName.trim();
    const phone = joinDraft.phone.trim();
    const note = joinDraft.note.trim();

    if (isSubmittingJoinRequest) return;

    if (!isJoinSubmissionReady) {
      notify("אנחנו עדיין מתחברים. נסה/י שוב בעוד רגע.");
      return;
    }

    if (!fullName || !phone) {
      notify("צריך למלא שם מלא ומספר טלפון נייד.");
      return;
    }

    setIsSubmittingJoinRequest(true);
    try {
      const isOzAdmin = isOzAdminShortcut({ fullName, phone });
      const result = await operationsRepository.createJoinRequest(
        state,
        { fullName, phone, note },
        actionDeps,
      );
      if (result.state) {
        setState(normalizePickupLocationSchedules(result.state));
      }
      const isRecognizedApprovedUser = result.recognizedApprovedUser === true;
      if (isOzAdmin || isRecognizedApprovedUser) {
        setJoinPreviewMode(false);
      }
      setSubmittedJoinRequestId(isOzAdmin || isRecognizedApprovedUser ? null : result.requestId);
      setScreen(isOzAdmin || isRecognizedApprovedUser ? "home" : "pending");
      notify(
        isOzAdmin
          ? "זוהית כמנהל. הרשאת הניהול פעילה."
          : isRecognizedApprovedUser
            ? "זוהית כמשתמש מאושר. אפשר להמשיך."
          : "בקשת ההצטרפות נשלחה לאישור מנהל.",
      );
    } catch (error) {
      notify(
        error instanceof Error && error.message === "duplicate-user-phone"
          ? "כבר קיימת בקשת הצטרפות או משתמש עם מספר הטלפון הזה."
          : "לא הצלחנו לשלוח את בקשת ההצטרפות. נסה/י שוב בעוד רגע.",
      );
    } finally {
      setIsSubmittingJoinRequest(false);
    }
  }

  async function saveDraftPackage() {
    if (isSavingPackage) return;

    if (!isApprovedUser) {
      notify("לא ניתן להוסיף חבילה לפני אישור משתמש חדש");
      setScreen(submittedJoinRequest ? "pending" : "join");
      return;
    }

    const ownerName = draft.ownerName.trim();
    const sensitiveDeliveryMessage = draft.sensitiveDeliveryMessage.trim();

    if (!ownerName) {
      notify("יש להזין את שם מקבל החבילה");
      return;
    }

    if (!sensitiveDeliveryMessage) {
      notify("יש להדביק את הודעת חברת המשלוחים");
      return;
    }

    function highlightPackage(packageId: string) {
      setHighlightedPackage({ id: packageId, nonce: Date.now() });
    }

    setIsSavingPackage(true);
    try {
      if (editingPackageId) {
        const nextState = await operationsRepository.updatePackage(
          state,
          {
            packageId: editingPackageId,
            ownerName,
            pickupLocationId: effectiveDraftPickupLocationId,
            sensitiveDeliveryMessage,
          },
          actionDeps,
        );
        applyRepositoryState(nextState);
        highlightPackage(editingPackageId);
        setEditingPackageId(null);
        notify("החבילה עודכנה.");
      } else {
        const result = await operationsRepository.createPackage(
          state,
          {
            ownerName,
            pickupLocationId: effectiveDraftPickupLocationId,
            sensitiveDeliveryMessage,
          },
          actionDeps,
        );
        pendingCreatedPackageIdsRef.current.add(result.packageId);
        applyRepositoryState(result.state);
        highlightPackage(result.packageId);
        notify("החבילה נוספה.");
      }
      setDraft(emptyDraft);
    } catch {
      notify(
        editingPackageId
          ? "לא הצלחנו לעדכן את החבילה. נסה/י שוב בעוד רגע."
          : "לא הצלחנו לשמור את החבילה. נסה/י שוב בעוד רגע.",
      );
    } finally {
      setIsSavingPackage(false);
    }
  }

  function startPackageEdit(pkg: DeliveryPackage) {
    if (pkg.status !== "waiting") {
      notify("אפשר לערוך רק חבילה שעדיין ממתינה לאיסוף.");
      return;
    }

    setEditingPackageId(pkg.id);
    setDraft({
      ownerName: pkg.ownerName,
      pickupLocationId: pkg.pickupLocationId,
      sensitiveDeliveryMessage: pkg.sensitiveDeliveryMessage ?? "",
    });
    window.setTimeout(() => {
      addPackageFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      packageOwnerInputRef.current?.focus();
    }, 0);
  }

  function cancelPackageEdit() {
    setEditingPackageId(null);
    setDraft(emptyDraft);
  }

  async function startPickupRun(locationId: string) {
    if (isStartingPickupRun) return;

    if (!isApprovedUser) {
      notify("לא ניתן לאסוף חבילה לפני אישור משתמש חדש");
      setScreen(submittedJoinRequest ? "pending" : "join");
      return;
    }

    setIsStartingPickupRun(true);
    try {
      const result = await operationsRepository.startPickupRun(state, locationId, actionDeps);
      if (!result.runId) {
        notify("אין כרגע חבילות שממתינות לאיסוף בנקודה הזאת.");
        return;
      }

      applyRepositoryState(result.state);
      if (result.sensitiveDetails) {
        setRevealedSensitiveDetails((current) => ({
          ...current,
          ...result.sensitiveDetails,
        }));
      }
      setActiveRunId(result.runId);
      setScreen("catalog");
      notify("אושר שאתה בנקודת האיסוף. ההודעות המקוריות פתוחות והגישה נרשמה בלוג.");
    } catch {
      notify("לא הצלחנו לפתוח את איסוף החנות. נסה/י שוב בעוד רגע.");
    } finally {
      setIsStartingPickupRun(false);
    }
  }

  async function logSensitiveAccess(packageId: string, action: "view_message" | "open_pickup_link") {
    if (!activeRunId) return;
    try {
      const nextState = await operationsRepository.logSensitiveAccess(
        state,
        {
          activeRunId,
          packageId,
          action,
        },
        actionDeps,
      );
      applyRepositoryState(nextState);
    } catch {
      notify("לא הצלחנו לרשום את פתיחת הפרטים הרגישים.");
    }
  }

  function handleOriginalMessageLinkClick(packageId: string) {
    setOpenedPickupLinkPackageIds((current) => {
      const next = new Set(current);
      next.add(packageId);
      return next;
    });
    void logSensitiveAccess(packageId, "open_pickup_link");
    notify("קישור האישור נפתח והפעולה נרשמה בלוג.");
  }

  function hasPickupLink(pkg: DeliveryPackage) {
    return extractMessageUrls(pkg.sensitiveDeliveryMessage ?? "").length > 0;
  }

  function wasPickupLinkOpened(packageId: string) {
    const runItem = activeRunItems.find((item) => item.packageId === packageId);
    return Boolean(runItem?.sensitivePickupLinkOpenedAt || openedPickupLinkPackageIds.has(packageId));
  }

  function mergePendingCreatedPackages(currentState: AppState, remoteState: AppState) {
    const pendingIds = pendingCreatedPackageIdsRef.current;
    if (!pendingIds.size) return remoteState;

    const remotePackageIds = new Set(remoteState.packages.map((pkg) => pkg.id));
    pendingIds.forEach((packageId) => {
      if (remotePackageIds.has(packageId)) pendingIds.delete(packageId);
    });

    const pendingLocalPackages = currentState.packages.filter(
      (pkg) => pendingIds.has(pkg.id) && !remotePackageIds.has(pkg.id),
    );

    if (!pendingLocalPackages.length) return remoteState;

    return {
      ...remoteState,
      packages: [...pendingLocalPackages, ...remoteState.packages],
    };
  }

  function applyRepositoryState(nextState: AppState | void) {
    if (nextState) setState(normalizePickupLocationSchedules(nextState));
  }

  function updateLocationDay(day: Weekday, patch: Partial<LocationDayDraft>) {
    setLocationDraft((current) => ({
      ...current,
      weeklyHours: {
        ...current.weeklyHours,
        [day]: {
          ...current.weeklyHours[day],
          ...patch,
        },
      },
    }));
  }

  function buildWeeklyHoursFromDraft() {
    const weeklyHours: WeeklyOpeningHours = {};
    let hasEnabledRange = false;

    for (const [day] of weekdayLabels) {
      const dayDraft = locationDraft.weeklyHours[day];
      if (!dayDraft.enabled) continue;

      const windows = [];
      if (dayDraft.firstOpen && dayDraft.firstClose) {
        windows.push({ open: dayDraft.firstOpen, close: dayDraft.firstClose });
      }
      if (dayDraft.secondEnabled && dayDraft.secondOpen && dayDraft.secondClose) {
        windows.push({ open: dayDraft.secondOpen, close: dayDraft.secondClose });
      }
      if (windows.length === 0) {
        return { weeklyHours, hasEnabledRange, isValid: false };
      }

      weeklyHours[day] = windows;
      hasEnabledRange = true;
    }

    return { weeklyHours, hasEnabledRange, isValid: true };
  }

  function openAddLocationModal() {
    setEditingLocationId(null);
    setLocationDraft(createEmptyLocationDraft());
    setIsAddLocationModalOpen(true);
  }

  function openEditLocationModal(location: PickupLocation) {
    setEditingLocationId(location.id);
    setLocationDraft(createLocationDraftFromLocation(location));
    setIsAddLocationModalOpen(true);
  }

  function closeLocationModal() {
    setEditingLocationId(null);
    setLocationDraft(createEmptyLocationDraft());
    setIsAddLocationModalOpen(false);
  }

  async function savePickupLocation() {
    if (isSavingLocation) return;

    const name = locationDraft.name.trim();
    const address = locationDraft.address.trim();
    const openingHours = locationDraft.openingHours.trim();
    const hours = buildWeeklyHoursFromDraft();

    if (!name || !address || !openingHours) {
      notify("צריך למלא שם, כתובת ושעות פתיחה.");
      return;
    }

    if (!hours.isValid || !hours.hasEnabledRange) {
      notify("צריך להגדיר לפחות יום פתוח אחד עם טווח שעות מלא.");
      return;
    }

    setIsSavingLocation(true);
    try {
      const locationInput = {
        name,
        address,
        openingHours,
        weeklyHours: hours.weeklyHours,
      };
      const result = editingLocationId
        ? await operationsRepository.updatePickupLocation(
            state,
            {
              locationId: editingLocationId,
              ...locationInput,
            },
            actionDeps,
          )
        : await operationsRepository.createPickupLocation(state, locationInput, actionDeps);
      applyRepositoryState(result.state);
      closeLocationModal();
      notify(editingLocationId ? "נקודת האיסוף עודכנה." : "נקודת האיסוף נוספה.");
    } catch {
      notify(
        editingLocationId
          ? "לא הצלחנו לעדכן את נקודת האיסוף. נסה/י שוב בעוד רגע."
          : "לא הצלחנו להוסיף את נקודת האיסוף. נסה/י שוב בעוד רגע.",
      );
    } finally {
      setIsSavingLocation(false);
    }
  }

  async function deletePickupLocation(locationId: string) {
    if (isSavingLocation) return;
    setPendingDeleteLocationId(locationId);
  }

  async function confirmDeletePickupLocation() {
    if (isSavingLocation || !pendingDeleteLocationId) return;

    setIsSavingLocation(true);
    try {
      const result = await operationsRepository.deletePickupLocation(
        state,
        pendingDeleteLocationId,
        actionDeps,
      );
      applyRepositoryState(result.state);
      setHomeLocationFilterId((current) =>
        current === pendingDeleteLocationId ? null : current,
      );
      if (editingLocationId === pendingDeleteLocationId) {
        closeLocationModal();
      }
      setPendingDeleteLocationId(null);
      notify("נקודת האיסוף נמחקה.");
    } catch {
      notify("לא הצלחנו למחוק את נקודת האיסוף. נסה/י שוב בעוד רגע.");
    } finally {
      setIsSavingLocation(false);
    }
  }

  async function markCollected(packageId: string) {
    if (collectingPackageId) return;

    const targetPackage = catalogPackages.find((pkg) => pkg.id === packageId);
    if (targetPackage && hasPickupLink(targetPackage) && !wasPickupLinkOpened(packageId)) {
      notify("פתח/י קודם את קישור האישור מתוך הודעת המשלוח.");
      return;
    }

    setCollectingPackageId(packageId);
    try {
      const nextState = await operationsRepository.markPackageCollected(
        state,
        { activeRunId, packageId },
        actionDeps,
      );
      applyRepositoryState(nextState);
      notify("החבילה סומנה כנאספה.");
    } catch {
      notify("לא הצלחנו לסמן את החבילה כנאספה. נסה/י שוב בעוד רגע.");
    } finally {
      setCollectingPackageId(null);
    }
  }

  async function markReceived(packageId: string) {
    if (receivingPackageId) return;

    setReceivingPackageId(packageId);
    try {
      const nextState = await operationsRepository.markPackageReceived(
        state,
        packageId,
        actionDeps,
      );
      applyRepositoryState(nextState);
      notify("החבילה סומנה כנתקבלה.");
    } catch {
      notify("לא הצלחנו לסמן את החבילה כנתקבלה. נסה/י שוב בעוד רגע.");
    } finally {
      setReceivingPackageId(null);
    }
  }

  async function updateArrivalPackage(packageId: string) {
    if (savingArrivalPackageId) return;

    const packagesCollectedByCurrentUser = state.packages.filter(
      (pkg) =>
        pkg.status === "collected" &&
        pkg.collectorUserId &&
        currentEquivalentUserIds.has(pkg.collectorUserId),
    );
    const packageToUpdate = packagesCollectedByCurrentUser.find((pkg) => pkg.id === packageId);
    if (!packageToUpdate) return;

    const draft = arrivalDraftsByPackageId[packageToUpdate.id] ?? {
      dropLocation: "gate-crate" as const,
      dropNote: "",
    };

    setSavingArrivalPackageId(packageId);
    try {
      const nextState = await operationsRepository.updateCollectedPackagesArrival(
        state,
        {
          updates: [
            {
              packageId: packageToUpdate.id,
              dropLocation: draft.dropLocation,
              dropNote: draft.dropNote,
            },
          ],
        },
        actionDeps,
      );
      applyRepositoryState(nextState);
      setArrivalDraftsByPackageId((current) => {
        const next = { ...current };
        delete next[packageId];
        return next;
      });
      setExpandedArrivalPackageIds((current) => {
        const next = new Set(current);
        next.delete(packageId);
        return next;
      });
      notify("החבילה נמסרה בקיבוץ.");
    } catch {
      notify("לא הצלחנו למסור את החבילה. נסה/י שוב בעוד רגע.");
    } finally {
      setSavingArrivalPackageId(null);
    }
  }

  async function deletePackage(packageId: string) {
    if (adminActionId) return;
    setPendingDeletePackageId(packageId);
  }

  async function confirmDeletePackage() {
    if (adminActionId || !pendingDeletePackageId) return;

    setAdminActionId(`delete-package-${pendingDeletePackageId}`);
    try {
      const nextState = await operationsRepository.deletePackage(
        state,
        pendingDeletePackageId,
        actionDeps,
      );
      applyRepositoryState(nextState);
      setPendingDeletePackageId(null);
      notify("החבילה נמחקה.");
    } catch {
      notify("לא הצלחנו למחוק את החבילה. נסה/י שוב בעוד רגע.");
    } finally {
      setAdminActionId(null);
    }
  }

  async function approveJoinRequest(requestId: string) {
    if (adminActionId) return;

    setAdminActionId(`approve-${requestId}`);
    try {
      const nextState = await operationsRepository.approveJoinRequest(
        state,
        requestId,
        actionDeps,
      );
      applyRepositoryState(nextState);
      if (requestId === submittedJoinRequestId) {
        setScreen("home");
        notify("הבקשה אושרה. ברוך/ה הבא/ה לחבילות להב.");
        return;
      }

      notify("המשתמש אושר.");
    } catch (error) {
      notify(
        error instanceof Error && error.message === "duplicate-user-phone"
          ? "לא ניתן לאשר: משתמש עם מספר הטלפון הזה כבר קיים."
          : "לא הצלחנו לאשר את המשתמש. נסה/י שוב בעוד רגע.",
      );
    } finally {
      setAdminActionId(null);
    }
  }

  async function rejectJoinRequest(requestId: string) {
    if (adminActionId) return;

    setAdminActionId(`reject-${requestId}`);
    try {
      const nextState = await operationsRepository.rejectJoinRequest(
        state,
        requestId,
        actionDeps,
      );
      applyRepositoryState(nextState);
      notify("בקשת ההצטרפות נדחתה.");
    } catch {
      notify("לא הצלחנו לדחות את הבקשה. נסה/י שוב בעוד רגע.");
    } finally {
      setAdminActionId(null);
    }
  }

  async function promoteUser(userId: string) {
    if (adminActionId) return;

    setAdminActionId(`promote-${userId}`);
    try {
      const nextState = await operationsRepository.promoteUser(state, userId, actionDeps);
      applyRepositoryState(nextState);
      notify("הרשאת מנהל ניתנה.");
    } catch {
      notify("לא הצלחנו לתת הרשאת מנהל. נסה/י שוב בעוד רגע.");
    } finally {
      setAdminActionId(null);
    }
  }

  async function blockUser(userId: string) {
    if (adminActionId) return;

    setAdminActionId(`block-${userId}`);
    try {
      const nextState = await operationsRepository.blockUser(state, userId, actionDeps);
      applyRepositoryState(nextState);
      notify("המשתמש נחסם.");
    } catch {
      notify("לא הצלחנו לחסום את המשתמש. נסה/י שוב בעוד רגע.");
    } finally {
      setAdminActionId(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label={`אפליקציית ${appName}`}>
        <div className="app-view">
          <div>
            <div className="statusbar">
              <span>14:28</span>
            </div>
            <header className="app-header">
              <div className="header-row">
                <div className="header-side header-left">
                  {headerConfig.backTarget ? (
                    <button
                      className="icon-button"
                      onClick={() => navigateToScreen(headerConfig.backTarget as Screen)}
                      type="button"
                      aria-label="חזרה"
                    >
                      <ArrowLeft />
                    </button>
                  ) : headerConfig.showAdmin ? (
                    <button
                      className="icon-button admin-header-button"
                      aria-label="ניהול"
                      onClick={() => navigateToScreen("admin")}
                      type="button"
                    >
                      <Settings />
                    </button>
                  ) : headerConfig.showBell ? (
                    <button className="icon-button" aria-label="התראות" type="button">
                      <Bell />
                    </button>
                  ) : null}
                </div>
                <div className="header-title-block">
                  <div className="brand-title">{headerConfig.title}</div>
                  {headerConfig.subtitle ? (
                    <div className="header-subtitle">{headerConfig.subtitle}</div>
                  ) : null}
                </div>
                <div className="header-side header-right">
                  {headerConfig.showMark ? (
                    <div
                      className="brand-mark"
                      aria-hidden="true"
                      style={{ backgroundImage: 'url("icon.svg")' }}
                    />
                  ) : null}
                </div>
              </div>
            </header>
          </div>

          <section className={`content content-${effectiveScreen}`}>{renderScreen()}</section>

          <nav className="bottom-nav" aria-label="ניווט ראשי">
            {navItems.map((item) => (
              <button
                aria-disabled={item.disabled ? "true" : undefined}
                className={`nav-item nav-${item.screen} ${effectiveScreen === item.screen ? "active" : ""}`}
                disabled={item.disabled}
                key={item.screen}
                onClick={() => navigateToScreen(item.screen)}
                title={item.disabled ? "מסירה זמינה לאחר אישור משתמש" : undefined}
                type="button"
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </section>

      {toast ? (
        <div className="toast" dir="rtl" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      {isHomeHelpOpen ? (
        <div
          className="modal-backdrop status-sheet-backdrop home-help-backdrop"
          onClick={() => setIsHomeHelpOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="home-help-title"
            aria-modal="true"
            className="status-bottom-sheet home-help-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="status-sheet-grip" aria-hidden="true" />
            <header className="status-sheet-header home-help-header">
              <div>
                <h2 id="home-help-title">איך משתמשים?</h2>
                <span>שני הדברים העיקריים שעושים באפליקציה</span>
              </div>
              <button
                aria-label="סגור"
                className="status-sheet-close"
                onClick={() => setIsHomeHelpOpen(false)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="home-help-flow-list">
              <article className="home-help-flow-card">
                <div className="home-help-flow-icon" aria-hidden="true">
                  <Package />
                </div>
                <div>
                  <h3>יש לי חבילה</h3>
                  <ol>
                    <li>לוחצים על הוספה.</li>
                    <li>בוחרים נקודת איסוף.</li>
                    <li>מדביקים את הודעת המשלוח המקורית, כולל קוד וקישור.</li>
                    <li>לוחצים שמור.</li>
                  </ol>
                  <p>החבילה תופיע בבית, ומי שנוסע לאסוף יראה אותה.</p>
                </div>
              </article>
              <article className="home-help-flow-card">
                <div className="home-help-flow-icon" aria-hidden="true">
                  <Truck />
                </div>
                <div>
                  <h3>אני אוסף/ת חבילות</h3>
                  <ol>
                    <li>לוחצים על איסוף.</li>
                    <li>בוחרים את נקודת האיסוף.</li>
                    <li>מאשרים שנמצאים בנקודה.</li>
                    <li>מציגים בחנות את הודעת המשלוח המקורית.</li>
                    <li>מסמנים נאספה.</li>
                    <li>בקיבוץ לוחצים מסירה ומעדכנים איפה כל חבילה הושארה.</li>
                  </ol>
                </div>
              </article>
            </div>
          </section>
        </div>
      ) : null}
      {activeStatusSheet ? (
        <div
          className="modal-backdrop status-sheet-backdrop"
          onClick={() => setActiveStatusSheet(null)}
          role="presentation"
        >
          <section
            aria-labelledby="status-sheet-title"
            aria-modal="true"
            className={`status-bottom-sheet status-bottom-sheet-${activeStatusSheet}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="status-sheet-grip" aria-hidden="true" />
            <header className="status-sheet-header">
              <div>
                <h2 id="status-sheet-title">{homeStatusBucketLabels[activeStatusSheet]}</h2>
                <span>{statusSheetPackages.length} חבילות</span>
              </div>
              <button
                aria-label="סגור"
                className="status-sheet-close"
                onClick={() => setActiveStatusSheet(null)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="status-sheet-list">
              {statusSheetPackages.length ? (
                statusSheetPackages.map((pkg) => (
                  <div className="status-sheet-row" key={pkg.id}>
                    <span className="status-sheet-name">{pkg.ownerName}</span>
                    <span className="status-sheet-meta">{statusSheetPackageMeta(pkg)}</span>
                  </div>
                ))
              ) : (
                <div className="status-sheet-empty">אין חבילות בסטטוס הזה כרגע.</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {pendingUnlockLocation ? (
        <div
          className={`modal-backdrop ${pendingUnlockAnchor ? "anchored" : ""}`}
          role="presentation"
        >
          <section
            aria-labelledby="pickup-unlock-title"
            aria-modal="true"
            className="confirm-modal"
            role="dialog"
            style={pendingUnlockStyle}
          >
            <h2 id="pickup-unlock-title">האם אתה כבר בנקודת האיסוף?</h2>
            <p>
              כדי לפתוח הודעות מקוריות וקישורי אישור עבור {pendingUnlockLocation.name},
              אשר שאתה נמצא עכשיו בנקודת האיסוף.
            </p>
            <div className="confirm-statement">
              אני מאשר שאני בנקודת האיסוף. הפעולה תירשם
            </div>
            <div className="card-actions">
              <button
                className="button"
                onClick={cancelPickupUnlock}
                type="button"
              >
                ביטול
              </button>
              <button
                className="button primary"
                disabled={isStartingPickupRun}
                onClick={confirmPickupUnlock}
                type="button"
              >
                {isStartingPickupRun ? "פותח איסוף..." : "אשר"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingDeletePackage ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-package-title"
            aria-modal="true"
            className="confirm-modal"
            role="dialog"
          >
            <h2 id="delete-package-title">למחוק את החבילה?</h2>
            <p>
              החבילה של {pendingDeletePackage.ownerName} תוסר מהאפליקציה ולא תופיע יותר
              ברשימות הפעילות.
            </p>
            <div className="confirm-statement danger-statement">
              הפעולה תשפיע מיד על כל המשתמשים.
            </div>
            <div className="card-actions">
              <button
                className="button"
                disabled={adminActionId !== null}
                onClick={() => setPendingDeletePackageId(null)}
                type="button"
              >
                ביטול
              </button>
              <button
                className="button warn"
                disabled={adminActionId !== null}
                onClick={confirmDeletePackage}
                type="button"
              >
                {adminActionId === `delete-package-${pendingDeletePackage.id}`
                  ? "מוחק..."
                  : "מחק חבילה"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingDeleteLocation ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-location-title"
            aria-modal="true"
            className="confirm-modal"
            role="dialog"
          >
            <h2 id="delete-location-title">למחוק נקודת איסוף?</h2>
            <p>
              נקודת האיסוף {pendingDeleteLocation.name} תוסר מרשימת נקודות האיסוף.
              חבילות קיימות לא יימחקו.
            </p>
            <div className="confirm-statement danger-statement">
              כדאי למחוק רק נקודה שכבר לא פעילה.
            </div>
            <div className="card-actions">
              <button
                className="button"
                disabled={isSavingLocation}
                onClick={() => setPendingDeleteLocationId(null)}
                type="button"
              >
                ביטול
              </button>
              <button
                className="button warn"
                disabled={isSavingLocation}
                onClick={confirmDeletePickupLocation}
                type="button"
              >
                {isSavingLocation ? "מוחק..." : "מחק נקודה"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {hoursLocation ? (
        <div className="modal-backdrop hours-backdrop" role="presentation">
          <section
            aria-labelledby="opening-hours-title"
            aria-modal="true"
            className="confirm-modal hours-modal"
            role="dialog"
          >
            <h2 id="opening-hours-title">שעות פתיחה</h2>
            <div className="hours-location-name">{hoursLocation.name}</div>
            <div className="hours-address">{hoursLocation.address}</div>
            <div className="hours-summary">
              {openingHoursRows(hoursLocation).map((row) => (
                <div className="hours-row" key={`${row.days}-${row.hours}`}>
                  {row.days ? <span className="hours-days">{row.days}</span> : null}
                  <span className="hours-value">{row.hours}</span>
                </div>
              ))}
            </div>
            <div className="card-actions">
              <button
                className="button primary full"
                onClick={() => setHoursLocationId(null)}
                type="button"
              >
                סגור
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isAddLocationModalOpen ? (
        <div className="modal-backdrop admin-location-backdrop" role="presentation">
          <section
            aria-labelledby="add-location-title"
            aria-modal="true"
            className="confirm-modal admin-location-modal"
            role="dialog"
          >
            <h2 id="add-location-title">
              {editingLocation ? "עריכת נקודת איסוף" : "הוסף נקודת איסוף"}
            </h2>
            <p>
              {editingLocation
                ? "עדכון נקודת איסוף ישפיע על הבית, הוספת חבילה ומסך האיסוף."
                : "נקודת איסוף חדשה תופיע בבית, בהוספת חבילה ובמסך האיסוף."}
            </p>

            <div className="location-manager-panel" aria-label="נקודות איסוף קיימות">
              <div className="location-manager-title">נקודות קיימות</div>
              <div className="location-manager-list">
                {state.pickupLocations.map((location) => (
                  <div
                    className={`location-manager-row ${
                      editingLocationId === location.id ? "selected" : ""
                    }`}
                    key={location.id}
                  >
                    <div>
                      <strong>{location.name}</strong>
                      <span>{location.address}</span>
                    </div>
                    <div className="location-manager-actions">
                      <button
                        aria-label={`ערוך ${location.name}`}
                        className="button icon-only"
                        disabled={isSavingLocation}
                        onClick={() => openEditLocationModal(location)}
                        type="button"
                      >
                        <Pencil />
                      </button>
                      <button
                        aria-label={`מחק ${location.name}`}
                        className="button icon-only warn"
                        disabled={isSavingLocation}
                        onClick={() => deletePickupLocation(location.id)}
                        type="button"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {editingLocation ? (
                <button
                  className="button full"
                  disabled={isSavingLocation}
                  onClick={openAddLocationModal}
                  type="button"
                >
                  <MapPin />
                  עבור להוספת נקודה חדשה
                </button>
              ) : null}
            </div>

            <div className="stack location-admin-form">
              <div className="field">
                <label htmlFor="location-name">שם נקודת איסוף</label>
                <input
                  id="location-name"
                  value={locationDraft.name}
                  onChange={(event) =>
                    setLocationDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="לדוגמה: דואר קיבוץ שובל"
                />
              </div>

              <div className="field">
                <label htmlFor="location-address">כתובת מלאה או תיאור מקום</label>
                <input
                  id="location-address"
                  value={locationDraft.address}
                  onChange={(event) =>
                    setLocationDraft((current) => ({ ...current, address: event.target.value }))
                  }
                  placeholder="לדוגמה: דואר שובל"
                />
              </div>

              <div className="field">
                <label htmlFor="location-opening-summary">שעות פתיחה לתצוגה</label>
                <input
                  id="location-opening-summary"
                  value={locationDraft.openingHours}
                  onChange={(event) =>
                    setLocationDraft((current) => ({
                      ...current,
                      openingHours: event.target.value,
                    }))
                  }
                  placeholder="לדוגמה: א-ה 08:00-13:00"
                />
              </div>

              <div className="hours-editor" aria-label="שעות פתיחה לפי ימים">
                {weekdayLabels.map(([day, label]) => {
                  const dayDraft = locationDraft.weeklyHours[day];

                  return (
                    <div className="hours-day-row" key={day}>
                      <label className="day-toggle">
                        <input
                          checked={dayDraft.enabled}
                          onChange={(event) =>
                            updateLocationDay(day, { enabled: event.target.checked })
                          }
                          type="checkbox"
                        />
                        <span>{label}</span>
                      </label>
                      <div className="time-pairs">
                        <div className="time-pair">
                          <input
                            aria-label={`פתיחה ${label}`}
                            disabled={!dayDraft.enabled}
                            onChange={(event) =>
                              updateLocationDay(day, { firstOpen: event.target.value })
                            }
                            type="time"
                            value={dayDraft.firstOpen}
                          />
                          <input
                            aria-label={`סגירה ${label}`}
                            disabled={!dayDraft.enabled}
                            onChange={(event) =>
                              updateLocationDay(day, { firstClose: event.target.value })
                            }
                            type="time"
                            value={dayDraft.firstClose}
                          />
                        </div>
                        <label className="second-range-toggle">
                          <input
                            checked={dayDraft.secondEnabled}
                            disabled={!dayDraft.enabled}
                            onChange={(event) =>
                              updateLocationDay(day, { secondEnabled: event.target.checked })
                            }
                            type="checkbox"
                          />
                          <span>טווח נוסף</span>
                        </label>
                        {dayDraft.secondEnabled ? (
                          <div className="time-pair">
                            <input
                              aria-label={`פתיחה נוספת ${label}`}
                              disabled={!dayDraft.enabled}
                              onChange={(event) =>
                                updateLocationDay(day, { secondOpen: event.target.value })
                              }
                              type="time"
                              value={dayDraft.secondOpen}
                            />
                            <input
                              aria-label={`סגירה נוספת ${label}`}
                              disabled={!dayDraft.enabled}
                              onChange={(event) =>
                                updateLocationDay(day, { secondClose: event.target.value })
                              }
                              type="time"
                              value={dayDraft.secondClose}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card-actions">
                <button
                  className="button"
                  disabled={isSavingLocation}
                  onClick={closeLocationModal}
                  type="button"
                >
                  ביטול
                </button>
                <button
                  className="button primary"
                  disabled={isSavingLocation}
                  onClick={savePickupLocation}
                  type="button"
                >
                  <MapPin />
                  {isSavingLocation
                    ? editingLocation
                      ? "מעדכן..."
                      : "מוסיף..."
                    : editingLocation
                      ? "עדכן"
                      : "הוסף"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );

  function renderScreen() {
    switch (effectiveScreen) {
      case "loading":
        return <LoadingScreen />;
      case "join":
        return (
          <JoinScreen
            canSubmit={isJoinSubmissionReady}
            isSubmitting={isSubmittingJoinRequest}
            joinDraft={joinDraft}
            onChange={setJoinDraft}
            onPending={submitJoinRequest}
          />
        );
      case "pending":
        return <PendingScreen request={submittedJoinRequest} />;
      case "home":
        return HomeScreen();
      case "add":
        return AddScreen();
      case "pickup":
        return PickupScreen();
      case "catalog":
        return CatalogScreen();
      case "arrival":
        return ArrivalScreen();
      case "admin":
        return AdminScreen();
    }
  }

  function HomeScreen() {
    return (
      <>
        <section className="home-top">
          <div className="home-title-row">
            <h1 className="screen-title">מה מצב החבילות?</h1>
            <button
              aria-label="איך משתמשים באפליקציה"
              className="home-help-button"
              onClick={() => setIsHomeHelpOpen(true)}
              title="איך משתמשים"
              type="button"
            >
              <Info />
            </button>
          </div>

          <div className="home-status-band" aria-label="סיכום מצב החבילות">
            <button
              className="home-status-item home-status-waiting"
              aria-label={`ממתינות לאיסוף: ${waitingPackages.length}`}
              onClick={() => setActiveStatusSheet("waiting")}
              title={`ממתינות לאיסוף: ${waitingPackages.length}`}
              type="button"
            >
              <span className="home-status-icon">
                <Package />
              </span>
              <strong>{waitingPackages.length}</strong>
              <span className="home-status-label">ממתינות לאיסוף</span>
            </button>
            <button
              className="home-status-item home-status-collected"
              aria-label={`נאספו: ${collectedPackages.length}`}
              onClick={() => setActiveStatusSheet("collected")}
              title={`נאספו: ${collectedPackages.length}`}
              type="button"
            >
              <span className="home-status-icon home-status-truck">
                <Truck />
              </span>
              <strong>{collectedPackages.length}</strong>
              <span className="home-status-label">נאספו</span>
            </button>
            <button
              className="home-status-item home-status-arrived"
              aria-label={`${homeStatusBucketLabels.arrived}: ${arrivedPackages.length}`}
              onClick={() => setActiveStatusSheet("arrived")}
              title={`${homeStatusBucketLabels.arrived}: ${arrivedPackages.length}`}
              type="button"
            >
              <span className="home-status-icon">
                <ClipboardList />
              </span>
              <strong>{arrivedPackages.length}</strong>
              <span className="home-status-label">{homeStatusBucketLabels.arrived}</span>
            </button>
            <button
              className="home-status-item home-status-delivered"
              aria-label={`${homeStatusBucketLabels.delivered}: ${deliveredPackages.length}`}
              onClick={() => setActiveStatusSheet("delivered")}
              title={`${homeStatusBucketLabels.delivered}: ${deliveredPackages.length}`}
              type="button"
            >
              <span className="home-status-icon">
                <Check />
              </span>
              <strong>{deliveredPackages.length}</strong>
              <span className="home-status-label">{homeStatusBucketLabels.delivered}</span>
            </button>
          </div>

          <div className="section-title-row pickup-locations-title">
            <h2>מיקומי איסוף</h2>
          </div>
          <div className="location-strip-wrap">
            <div
              className="location-strip"
              aria-label="סינון לפי נקודת איסוף"
              onScroll={updatePickupStripDirection}
              ref={pickupLocationStripRef}
            >
              {state.pickupLocations.map((location) => {
                const locationPackageCount = state.packages.filter(
                  (pkg) => pkg.pickupLocationId === location.id && pkg.status === "waiting",
                ).length;
                const openState = getPickupLocationOpenState(location);
                const displayName = pickupLocationDisplayName(location);
                const selectLocation = () => {
                  if (locationPackageCount > 0) {
                    openPickupScreenForLocation(location.id);
                  }
                };
                return (
                  <div className="pickup-card-group" key={location.id}>
                    <div
                      aria-label={`${displayName}, ${locationPackageCount} חבילות ממתינות`}
                      className={`pickup-card pickup-card-${openState} ${homeLocationFilterId === location.id ? "selected" : ""}`}
                      data-pickup-location-id={location.id}
                      onClick={(event) => {
                        if (
                          (event.target as HTMLElement | null)?.closest(
                            ".opening-hours-icon-button",
                          )
                        ) {
                          return;
                        }
                        if (locationPackageCount > 0) {
                          openPickupScreenForLocation(location.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectLocation();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span>{displayName}</span>
                      <strong>{locationPackageCount}</strong>
                    </div>
                    <button
                      aria-label={`שעות פתיחה - ${displayName}`}
                      className={`opening-hours-icon-button opening-hours-icon-${openState}`}
                      onClick={() => setHoursLocationId(location.id)}
                      title="שעות פתיחה"
                      type="button"
                    >
                      <span>{openState === "open" ? "OPEN" : "CLOSED"}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              aria-label="הצג עוד מיקומי איסוף"
              className="location-more-indicator"
              data-at-end="false"
              onClick={scrollPickupLocations}
              ref={pickupLocationArrowRef}
              type="button"
            >
              <ChevronLeft />
            </button>
          </div>
        </section>

        <section className="home-list">
          <div className="section-title-row home-list-title">
            <h2>סטטוס חבילה</h2>
            <span>{visibleHomePackages.length} פריטים</span>
          </div>
          <div className="package-list">
            {visibleHomePackages.length ? (
              visibleHomePackages.map((pkg) => <PackageCard key={pkg.id} pkg={pkg} />)
            ) : (
              <div className="card empty-state">אין חבילות להצגה כרגע.</div>
            )}
          </div>
        </section>
      </>
    );
  }

  function AddScreen() {
    return (
      <>
        <div className="screen-intro">
          הזן/י את פרטי החבילה כמו שמופיעים בהודעה מחברת המשלוחים
        </div>

        <form className="stack" onSubmit={(event) => event.preventDefault()} ref={addPackageFormRef}>
          {editingPackageId ? (
            <div className="edit-mode-banner" role="status">
              <strong>עריכת חבילה קיימת</strong>
              <span>עדכון פרטים זמין רק כל עוד החבילה ממתינה לאיסוף.</span>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="owner">שם מקבל החבילה</label>
            <input
              id="owner"
              placeholder={packageOwnerExample}
              ref={packageOwnerInputRef}
              value={draft.ownerName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, ownerName: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="pickup-location">בחר/י נקודת איסוף</label>
            {state.pickupLocations.length ? (
              <select
                id="pickup-location"
                value={effectiveDraftPickupLocationId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pickupLocationId: event.target.value,
                  }))
                }
              >
                {state.pickupLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="card empty-state">אין נקודות איסוף פעילות.</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="message">הודעת המשלוח המקורית</label>
            <textarea
              id="message"
              placeholder={deliveryMessageExample}
              value={draft.sensitiveDeliveryMessage}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  sensitiveDeliveryMessage: event.target.value,
                }))
              }
            />
            {draft.sensitiveDeliveryMessage ? (
              <p
                className={`message-link-status ${
                  draftMessageUrls.length ? "message-link-status-found" : ""
                }`}
              >
                {draftMessageUrls.length
                  ? "זוהה קישור איסוף"
                  : "לא זוהה קישור. אפשר לשמור אם אין קישור בהודעה."}
              </p>
            ) : null}
          </div>
          <button
            className="button primary full"
            disabled={isSavingPackage || !isPackageDraftReady}
            onClick={saveDraftPackage}
            type="button"
          >
            <Save />
            {isSavingPackage ? "שומר..." : packageActionLabel}
          </button>
          {editingPackageId ? (
            <button className="button full" onClick={cancelPackageEdit} type="button">
              ביטול עריכה
            </button>
          ) : null}
        </form>

        <section className="added-packages-panel" aria-label="חבילות שהוספת">
          <div className="section-title-row added-packages-title-row">
            <h2>חבילות שהוספת</h2>
            <span>{userAddedPackages.length} פריטים</span>
          </div>
          <p className="section-help-text added-packages-help">
            צפה בחבילות שהוספו בעבר וערוך פרטי חבילה
          </p>
          <div className="added-packages-list">
            {userAddedPackages.length ? (
              userAddedPackages.map((pkg) => {
                const canEditPackage = pkg.status === "waiting";
                const isHighlightedPackage = highlightedPackage?.id === pkg.id;
                return (
                  <article
                    className={`added-package-row ${isHighlightedPackage ? "recently-added" : ""}`}
                    key={pkg.id}
                  >
                    <div className="added-package-main">
                      <div className="added-package-head">
                        <strong>{pkg.ownerName}</strong>
                        <span>
                          {isHighlightedPackage ? "נוספה עכשיו" : statusLabel(pkg.status)}
                        </span>
                      </div>
                      <div className="added-package-meta">
                        {formatHebrewDateTime(pkg.createdAt ?? pkg.updatedAt)} ·{" "}
                        {getLocationName(state.pickupLocations, pkg.pickupLocationId)}
                      </div>
                      <div className="added-package-message">
                        {pkg.sensitiveDeliveryMessage ??
                          "הודעת המשלוח המקורית שמורה ומוגנת."}
                      </div>
                    </div>
                    <button
                      className="button compact"
                      disabled={!canEditPackage || isSavingPackage}
                      onClick={() => startPackageEdit(pkg)}
                      title={
                        canEditPackage
                          ? "עריכת פרטי החבילה"
                          : "אפשר לערוך רק חבילה שממתינה לאיסוף"
                      }
                      type="button"
                    >
                      ערוך
                    </button>
                  </article>
                );
              })
            ) : (
              <div className="card empty-state">עדיין לא הוספת חבילות.</div>
            )}
          </div>
        </section>
      </>
    );
  }

  function PickupScreen() {
    return (
      <>
        <h1 className="screen-title">אני נוסע לאסוף</h1>
        <p className="screen-kicker">
          בחר נקודת איסוף. פרטי החבילות ייפתחו רק אחרי אישור שאתה כבר שם.
        </p>
        <div className="stack">
          {state.pickupLocations.map((location) => {
            const count = state.packages.filter(
              (pkg) => pkg.pickupLocationId === location.id && pkg.status === "waiting",
            ).length;
            const isSelectedWaitingLocation = homeLocationFilterId === location.id && count > 0;
            return (
              <button
                aria-pressed={isSelectedWaitingLocation}
                className={`location-button ${isSelectedWaitingLocation ? "selected" : ""}`}
                data-pickup-location-id={location.id}
                key={location.id}
                onClick={(event) => void requestPickupUnlock(location.id, event.currentTarget)}
                type="button"
              >
                <span>
                  <strong>{location.name}</strong>
                  <small>
                    {count} חבילות ממתינות · {location.address}
                  </small>
                </span>
                <ChevronLeft />
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function CatalogScreen() {
    return (
      <>
        <div className="catalog-header">
          <ShieldCheck />
          <span>
            אתה מאשר שאתה בנקודת האיסוף. הפעולה נרשמה, וההודעות המקוריות פתוחות עבורך.
          </span>
        </div>

        <div className="stack">
          {catalogPackages.length ? (
            catalogPackages.map((pkg, index) => (
              <CatalogCard index={index} key={pkg.id} pkg={pkg} />
            ))
          ) : (
            <div className="card">אין כרגע חבילות בקטלוג הזה.</div>
          )}
        </div>
      </>
    );
  }

  function ArrivalScreen() {
    const packagesCollectedByCurrentUser = state.packages.filter(
      (pkg) =>
        pkg.status === "collected" &&
        pkg.collectorUserId &&
        currentEquivalentUserIds.has(pkg.collectorUserId),
    );

    function arrivalDraftForPackage(packageId: string): ArrivalPackageDraft {
      return (
        arrivalDraftsByPackageId[packageId] ?? {
          dropLocation: "gate-crate",
          dropNote: "",
        }
      );
    }

    function updateArrivalDraft(packageId: string, patch: Partial<ArrivalPackageDraft>) {
      setArrivalDraftsByPackageId((current) => ({
        ...current,
        [packageId]: {
          ...(current[packageId] ?? {
            dropLocation: "gate-crate" as const,
            dropNote: "",
          }),
          ...patch,
        },
      }));
    }

    function toggleArrivalPackage(packageId: string) {
      setExpandedArrivalPackageIds((current) => {
        const next = new Set(current);
        if (next.has(packageId)) {
          next.delete(packageId);
        } else {
          next.add(packageId);
        }
        return next;
      });
    }

    const shouldCollapsePackageRows = packagesCollectedByCurrentUser.length > 1;

    return (
      <>
        <h1 className="screen-title">החבילות הגיעו</h1>
        <p className="screen-kicker">עדכון מיקום בקיבוץ אחרי האיסוף.</p>
        <div className="stack">
          <div className="card">
            <div className="package-top">
              <div>
                <div className="package-name">חבילות שאספת</div>
                <div className="package-meta">
                  {packagesCollectedByCurrentUser.length
                    ? "אלה החבילות שמחכות לעדכון מיקום בקיבוץ."
                    : "אין כרגע חבילות שסומנו כנאספו על ידך."}
                </div>
              </div>
              <span className="badge waiting">{packagesCollectedByCurrentUser.length}</span>
            </div>
          </div>

          {packagesCollectedByCurrentUser.map((pkg, index) => {
            const arrivalDraft = arrivalDraftForPackage(pkg.id);
            const isExpanded =
              !shouldCollapsePackageRows || expandedArrivalPackageIds.has(pkg.id);
            return (
              <div className="card arrival-package-card" key={pkg.id}>
                <button
                  aria-expanded={isExpanded}
                  className="arrival-package-toggle"
                  onClick={() => toggleArrivalPackage(pkg.id)}
                  type="button"
                >
                  <span className="package-top arrival-package-toggle-content">
                    <span>
                      <span className="package-name">{pkg.ownerName}</span>
                      <span className="package-meta">
                        {getLocationName(state.pickupLocations, pkg.pickupLocationId)}
                      </span>
                    </span>
                    <span className="arrival-toggle-meta">
                      <span className="badge waiting">{index + 1}</span>
                      <ChevronLeft />
                    </span>
                  </span>
                </button>

                {isExpanded ? (
                  <div className="arrival-package-details">
                    <div className="field">
                      <label htmlFor={`drop-location-${pkg.id}`}>איפה השארת את החבילה?</label>
                      <select
                        id={`drop-location-${pkg.id}`}
                        value={arrivalDraft.dropLocation}
                        onChange={(event) =>
                          updateArrivalDraft(pkg.id, {
                            dropLocation: event.target.value as KibbutzDropLocation,
                          })
                        }
                      >
                        <option value="gate-crate">בדולב בש.ג</option>
                        <option value="kolbo">בכלבו</option>
                        <option value="collector-home">אצלי בבית</option>
                        <option value="direct-home">נמסר ישירות לבעל החבילה</option>
                        <option value="other">אחר</option>
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor={`drop-note-${pkg.id}`}>הערה למסירה</label>
                      <textarea
                        id={`drop-note-${pkg.id}`}
                        placeholder={dropNoteExamples[arrivalDraft.dropLocation]}
                        value={arrivalDraft.dropNote}
                        onChange={(event) =>
                          updateArrivalDraft(pkg.id, { dropNote: event.target.value })
                        }
                      />
                    </div>

                    <button
                      className="button primary full arrival-package-submit"
                      disabled={savingArrivalPackageId === pkg.id}
                      onClick={() => updateArrivalPackage(pkg.id)}
                      type="button"
                    >
                      <MapPinCheck />
                      {savingArrivalPackageId === pkg.id ? "מוסר..." : "מסור חבילה"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function AdminScreen() {
    const isSuperAdmin = isOzSuperAdminUser(currentUser);
    const approvedUsers = dedupeUsersByPhone(
      state.users.filter(
        (user) => user.role === "member" && user.verificationStatus === "approved",
      ),
      currentUserId,
    );
    const managerUsers = dedupeUsersByPhone(
      state.users.filter(
        (user) =>
          (user.role === "admin" || user.role === "owner") &&
          user.verificationStatus === "approved",
      ),
      currentUserId,
    );
    const adminPackages = state.packages.filter((pkg) =>
      shouldShowPackageInAdminList(pkg, currentTimeMs),
    );

    return (
      <>
        <h1 className="screen-title">ניהול קהילה</h1>
        <p className="screen-kicker">בקשות הצטרפות, הרשאות מנהל ונקודות איסוף.</p>

        <div className="admin-card add-location-card">
          <button
            className="button primary full"
            onClick={openAddLocationModal}
            type="button"
          >
            <MapPin />
            הוסף נקודת איסוף
          </button>
          <div className="package-meta admin-location-count">
            {state.pickupLocations.length} נקודות איסוף פעילות
          </div>
        </div>

        <div className="summary-grid" aria-label="סיכום מנהל">
          <button
            aria-pressed={adminListView === "pending"}
            className={`metric metric-button ${adminListView === "pending" ? "selected" : ""}`}
            onClick={() => setAdminListView("pending")}
            type="button"
          >
            <strong>{pendingJoinRequests.length}</strong>
            <span>ממתינים</span>
          </button>
          <button
            aria-pressed={adminListView === "approved"}
            className={`metric metric-button ${adminListView === "approved" ? "selected" : ""}`}
            onClick={() => setAdminListView("approved")}
            type="button"
          >
            <strong>{approvedUsers.length}</strong>
            <span>מאושרים</span>
          </button>
          <button
            aria-pressed={adminListView === "managers"}
            className={`metric metric-button ${adminListView === "managers" ? "selected" : ""}`}
            onClick={() => setAdminListView("managers")}
            type="button"
          >
            <strong>{managerUsers.length}</strong>
            <span>מנהלים</span>
          </button>
          <button
            aria-pressed={adminListView === "packages"}
            className={`metric metric-button ${adminListView === "packages" ? "selected" : ""}`}
            onClick={() => setAdminListView("packages")}
            type="button"
          >
            <strong>{adminPackages.length}</strong>
            <span>חבילות</span>
          </button>
        </div>

        <div className="stack">
          {adminListView === "pending" && pendingJoinRequests.length === 0 ? (
            <div className="card empty-state">אין בקשות שממתינות לטיפול.</div>
          ) : null}

          {adminListView === "pending"
            ? pendingJoinRequests.map((request) => (
                <div className="admin-card" key={request.id}>
                  <div className="package-top">
                    <div>
                      <div className="package-name">{request.fullName}</div>
                      <div className="package-meta">
                        {request.phone} · ביקש/ה להצטרף
                      </div>
                    </div>
                    <span className="badge waiting">ממתין</span>
                  </div>
                  {request.note ? <div className="message-preview">{request.note}</div> : null}
                  <div className="card-actions">
                    <button
                      className="button primary"
                      disabled={adminActionId !== null}
                      onClick={() => approveJoinRequest(request.id)}
                      type="button"
                    >
                      <UserCheck />
                      {adminActionId === `approve-${request.id}` ? "מאשר..." : "אשר"}
                    </button>
                    <button
                      className="button warn"
                      disabled={adminActionId !== null}
                      onClick={() => rejectJoinRequest(request.id)}
                      type="button"
                    >
                      <UserX />
                      {adminActionId === `reject-${request.id}` ? "דוחה..." : "דחה"}
                    </button>
                  </div>
                </div>
              ))
            : null}

          {adminListView === "approved" && approvedUsers.length === 0 ? (
            <div className="card empty-state">אין משתמשים מאושרים רגילים.</div>
          ) : null}

          {adminListView === "approved"
            ? approvedUsers.map((user) => (
                <div className="admin-card" key={user.id}>
                  <div className="package-top">
                    <div>
                      <div className="package-name">{user.fullName}</div>
                      <div className="package-meta">{user.phone} · חברה רגילה</div>
                    </div>
                    <span className="badge done">מאושרת</span>
                  </div>
                  <div className="card-actions">
                    {isSuperAdmin ? (
                      <button
                        className="button"
                        disabled={adminActionId !== null}
                        onClick={() => promoteUser(user.id)}
                        type="button"
                      >
                        <ShieldPlus />
                        {adminActionId === `promote-${user.id}`
                          ? "מעדכן הרשאה..."
                          : "הענק הרשאת מנהל"}
                      </button>
                    ) : null}
                    <button
                      className="button warn"
                      disabled={adminActionId !== null || user.id === currentUserId}
                      onClick={() => blockUser(user.id)}
                      type="button"
                    >
                      <UserX />
                      {adminActionId === `block-${user.id}` ? "חוסם..." : "חסום משתמש"}
                    </button>
                  </div>
                </div>
              ))
            : null}

          {adminListView === "managers" && managerUsers.length === 0 ? (
            <div className="card empty-state">אין מנהלים להצגה.</div>
          ) : null}

          {adminListView === "managers" && managerUsers.length > 0 && !isSuperAdmin ? (
            <div className="info-note">
              <Info />
              מחיקת מנהלים זמינה רק לעוז כרמל עם מספר הטלפון 0584411883.
            </div>
          ) : null}

          {adminListView === "managers"
            ? managerUsers.map((user) => (
                <div className="admin-card" key={user.id}>
                  <div className="package-top">
                    <div>
                      <div className="package-name">{user.fullName}</div>
                      <div className="package-meta">
                        {user.phone} · {isOzSuperAdminUser(user) ? "מנהל ראשי" : "מנהל"}
                      </div>
                    </div>
                    <span className="badge done">
                      {isOzSuperAdminUser(user) ? "ראשי" : "מנהל"}
                    </span>
                  </div>
                  {isSuperAdmin && !isOzSuperAdminUser(user) && user.id !== currentUserId ? (
                    <button
                      className="button warn full"
                      disabled={adminActionId !== null}
                      onClick={() => blockUser(user.id)}
                      type="button"
                    >
                      <UserX />
                      {adminActionId === `block-${user.id}` ? "מוחק..." : "מחק מנהל"}
                    </button>
                  ) : null}
                </div>
              ))
            : null}

          {adminListView === "packages" && adminPackages.length === 0 ? (
            <div className="card empty-state">אין חבילות להצגה.</div>
          ) : null}

          {adminListView === "packages"
            ? adminPackages.map((pkg) => {
                const collectorName = getUserName(state.users, pkg.collectorUserId);
                const pickupLocationName = getLocationName(
                  state.pickupLocations,
                  pkg.pickupLocationId,
                );
                return (
                  <div className="admin-card" key={pkg.id}>
                    <div className="package-top">
                      <div>
                        <div className="package-name">{pkg.ownerName}</div>
                        <div className="package-meta">
                          {pickupLocationName} · {statusLabel(pkg.status)}
                        </div>
                      </div>
                      <span className={statusBadgeClass(pkg.status)}>
                        {statusLabel(pkg.status)}
                      </span>
                    </div>
                    <div className="message-preview admin-package-log">
                      <strong>יומן חבילה</strong>
                      <span>נקודת איסוף: {pickupLocationName}</span>
                      <span>אסף/ה: {collectorName ?? "טרם נאספה"}</span>
                      {pkg.currentKibbutzLocationText ? (
                        <span>מסירה בקיבוץ: {pkg.currentKibbutzLocationText}</span>
                      ) : null}
                      {pkg.deliveredAt ? (
                        <span>אישור קבלה: {formatHebrewDateTime(pkg.deliveredAt)}</span>
                      ) : null}
                    </div>
                    <div className="card-actions single-action">
                      <button
                        className="button warn full"
                        disabled={adminActionId !== null}
                        onClick={() => deletePackage(pkg.id)}
                        type="button"
                      >
                        <Trash2 />
                        {adminActionId === `delete-package-${pkg.id}` ? "מוחק..." : "מחק חבילה"}
                      </button>
                    </div>
                  </div>
                );
              })
            : null}
        </div>
      </>
    );
  }

  function PackageCard({ pkg }: { pkg: DeliveryPackage }) {
    const collectorName = getUserName(state.users, pkg.collectorUserId);
    const detailBadge = homePackageDetailBadge(pkg);
    const canConfirmReceived =
      pkg.ownerUserId === currentUserId &&
      (pkg.status === "arrived" || pkg.status === "ready_for_handoff");
    const isReceiving = receivingPackageId === pkg.id;
    const wasCollected =
      pkg.status === "collected" ||
      pkg.status === "arrived" ||
      pkg.status === "ready_for_handoff" ||
      pkg.status === "delivered";

    return (
      <div className="card package-card">
        <div className="package-icon" aria-hidden="true">
          <Package />
        </div>
        <div className="package-main">
          <div className="package-top">
            <div>
              <div className="package-name">{pkg.ownerName}</div>
              <div className="package-meta">
                {getLocationName(state.pickupLocations, pkg.pickupLocationId)}
              </div>
            </div>
            {getHomePackageStatusBucket(pkg.status) === "waiting" ? (
              <button
                className={`${homePackageStatusBadgeClass(pkg)} status-action-badge`}
                onClick={() => openPickupScreenForLocation(pkg.pickupLocationId)}
                type="button"
              >
                {homePackageStatusLabel(pkg)}
              </button>
            ) : (
              <span className={homePackageStatusBadgeClass(pkg)}>
                {homePackageStatusLabel(pkg)}
              </span>
            )}
          </div>
          {detailBadge ? (
            <span className={detailBadge.className}>
              {detailBadge.icon}
              {detailBadge.text}
            </span>
          ) : null}
          {collectorName && wasCollected ? (
            <div className="package-note">נאספה על ידי {collectorName}</div>
          ) : null}
          {canConfirmReceived ? (
            <div className="receive-action-row">
              <button
                className="button receive-button"
                disabled={receivingPackageId !== null}
                onClick={() => markReceived(pkg.id)}
                type="button"
              >
                {isReceiving ? "מאשר..." : "אשר קבלה"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function OriginalMessageText({ pkg }: { pkg: DeliveryPackage }) {
    const message = pkg.sensitiveDeliveryMessage ?? "ההודעה המקורית עדיין לא נפתחה.";
    const parts = message.split(urlPattern);

    return (
      <>
        {parts.map((part, partIndex) => {
          if (!fullUrlPattern.test(part)) {
            return <Fragment key={`${pkg.id}-text-${partIndex}`}>{part}</Fragment>;
          }

          const cleanUrl = part.replace(/[.,;:!?]+$/u, "");
          const trailing = part.slice(cleanUrl.length);

          return (
            <Fragment key={`${pkg.id}-link-${partIndex}`}>
              <a
                dir="ltr"
                href={cleanUrl}
                onClick={() => handleOriginalMessageLinkClick(pkg.id)}
                rel="noopener noreferrer"
                target="_blank"
              >
                {cleanUrl}
              </a>
              {trailing}
            </Fragment>
          );
        })}
      </>
    );
  }

  function CatalogCard({ pkg, index }: { pkg: DeliveryPackage; index: number }) {
    const runItem = activeRunItems.find((item) => item.packageId === pkg.id);
    const isCollected = runItem?.itemStatus === "collected" || pkg.status === "collected";
    const isCollecting = collectingPackageId === pkg.id;
    const pickupUrls = extractMessageUrls(pkg.sensitiveDeliveryMessage ?? "");
    const pickupUrl = pickupUrls[0];
    const requiresPickupLink = Boolean(pickupUrl);
    const pickupLinkOpened = !requiresPickupLink || wasPickupLinkOpened(pkg.id);
    const canMarkCollected = !isCollected && collectingPackageId === null && pickupLinkOpened;
    return (
      <div className="card catalog-card">
        <div className="catalog-card-head">
          <span className="catalog-index">{index + 1}</span>
          <div className="catalog-person">
            <div className="package-name">{pkg.ownerName}</div>
            <div className="package-meta">
              {pkg.parsedCourierCompany ?? "חברת שילוח לא זוהתה"} ·{" "}
              {pkg.parsedTrackingNumber ?? pkg.sensitivePackageCode ?? "פרט מוגן"} · נמען{" "}
              {pkg.parsedAddresseeName ?? pkg.ownerName}
            </div>
          </div>
          <span className={isCollected ? "badge done" : "badge waiting"}>
            {isCollected ? "נאספה" : "ממתינה לאיסוף"}
          </span>
        </div>

        <div className="original-message">
          <div className="original-message-title">
            <span>
              <Copy />
              הודעה מקורית מחברת המשלוחים
            </span>
            {runItem?.sensitiveMessageViewedAt ? <span>גישה נרשמה</span> : null}
          </div>
          <p>
            <OriginalMessageText pkg={pkg} />
          </p>
        </div>

        <div className="catalog-actions">
          {pickupUrl ? (
            <a
              className={`button pickup-link-button ${pickupLinkOpened ? "opened" : ""}`}
              dir="rtl"
              href={pickupUrl}
              onClick={() => handleOriginalMessageLinkClick(pkg.id)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {pickupLinkOpened ? "קישור נפתח" : "פתח קישור אישור"}
            </a>
          ) : null}
          <button
            aria-pressed={isCollected}
            className={`button collect-button ${isCollected ? "checked" : ""}`}
            disabled={!canMarkCollected}
            onClick={() => markCollected(pkg.id)}
            type="button"
          >
            <span className="collect-checkbox-mark" aria-hidden="true">
              {isCollected ? <Check /> : null}
            </span>
            {isCollecting ? "מסמן..." : isCollected ? "נאספה" : pickupLinkOpened ? "סמן נאספה" : "פתח קישור קודם"}
          </button>
        </div>
      </div>
    );
  }
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-illustration" aria-hidden="true">
        <Package />
      </div>
      <h1>טוען את חבילות להב...</h1>
      <p>בודקים את פרטי המשתמש.</p>
    </div>
  );
}

function JoinScreen({
  canSubmit,
  isSubmitting,
  joinDraft,
  onChange,
  onPending,
}: {
  canSubmit: boolean;
  isSubmitting: boolean;
  joinDraft: JoinDraft;
  onChange: (draft: JoinDraft | ((current: JoinDraft) => JoinDraft)) => void;
  onPending: () => Promise<void>;
}) {
  return (
    <>
      <div className="screen-intro join-intro">
        אימות טלפון ואז בקשת אישור ממנהל הקהילה.
      </div>
      <div className="stack join-stack">
        <div className="field">
          <label htmlFor="join-phone">מספר טלפון נייד</label>
          <input
            id="join-phone"
            inputMode="tel"
            placeholder="050-1234567"
            value={joinDraft.phone}
            onChange={(event) =>
              onChange((current) => ({ ...current, phone: event.target.value }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="join-name">שם מלא</label>
          <input
            id="join-name"
            placeholder="ישראלה ישראלי"
            value={joinDraft.fullName}
            onChange={(event) =>
              onChange((current) => ({ ...current, fullName: event.target.value }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="join-note">הערה למנהל</label>
          <textarea
            id="join-note"
            value={joinDraft.note}
            onChange={(event) =>
              onChange((current) => ({ ...current, note: event.target.value }))
            }
          />
        </div>
        <button
          className="button primary full"
          disabled={isSubmitting || !canSubmit}
          onClick={onPending}
          type="button"
        >
          <Send />
          {!canSubmit ? "מתחבר..." : isSubmitting ? "שולח בקשה..." : "שלח בקשת הצטרפות"}
        </button>
      </div>
    </>
  );
}

function PendingScreen({ request }: { request?: AppState["joinRequests"][number] }) {
  return (
    <>
      <div className="waiting-hero">
        <div className="waiting-illustration" aria-hidden="true">
          <Mail />
          <Clock />
        </div>
        <h1>ממתין לאישור מנהל</h1>
        <p>בקשת ההצטרפות שלך התקבלה ותיבדק על ידי מנהל האפליקציה.</p>
      </div>
      <div className="review-grid pending-stack">
        <ReviewRow icon={<User />} label="שם מלא" value={request?.fullName ?? ""} />
        <ReviewRow icon={<Phone />} label="טלפון נייד" value={request?.phone ?? ""} />
        <ReviewRow icon={<Clock />} label="סטטוס" value="ממתין לאישור" />
        <ReviewRow
          icon={<CalendarDays />}
          label="נשלח בתאריך"
          value={formatHebrewDate(request?.createdAt)}
        />
      </div>
      <div className="info-note">
        <Info />
        נעדכן אותך כאן מיד לאחר קבלת ההחלטה. תודה על הסבלנות.
      </div>
    </>
  );
}

function ReviewRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="review-row">
      {icon ? <span className="review-icon">{icon}</span> : null}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

