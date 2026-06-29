"use client";

import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Home,
  Info,
  Lock,
  Mail,
  MapPin,
  MapPinCheck,
  Package,
  Phone,
  PlusCircle,
  Route,
  Save,
  Send,
  Settings,
  ShieldCheck,
  ShieldPlus,
  User,
  UserCheck,
  UserX,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getConfiguredOperationsRepository } from "@/lib/app-repository";
import type { RevealedSensitivePackageDetails } from "@/lib/app-repository-contract";
import {
  createId,
  updateCollectedPackagesArrival,
} from "@/lib/app-state-actions";
import { localDemoRepository } from "@/lib/app-state-repository";
import { initialAppState } from "@/lib/demo-data";
import { subscribeFirestoreAppState } from "@/lib/firebase/app-state-subscriptions";
import { subscribeFirebaseSession } from "@/lib/firebase/auth-bootstrap";
import { hasFirebaseConfig } from "@/lib/firebase/client";
import { isOzAdminShortcut } from "@/lib/oz-admin-shortcut";
import { getPickupLocationOpenState } from "@/lib/pickup-location-hours";
import type {
  AppState,
  DeliveryPackage,
  KibbutzDropLocation,
  PackageStatus,
  PickupLocation,
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

interface UnlockAnchor {
  top: number;
  left: number;
  width: number;
}

const appName = "חבילות להב";

const emptyDraft: DraftPackage = {
  ownerName: "דניאלה קטלן",
  pickupLocationId: "pitzutz",
  sensitiveDeliveryMessage:
    "שלום Daniela, משלוח AE04062389 ממתין לאיסוף בפיצוץ להבים. לאישור איסוף לחצו: https://u.cheetahint.com/vknpgt0",
};

const initialJoinDraft: JoinDraft = {
  fullName: "טל יוד",
  phone: "050-203-4475",
  note: "היי, אני חבר/ת להב. אפשר לאשר אותי?",
};

const screenLabels: Array<[Screen, string]> = [
  ["join", "הצטרפות"],
  ["pending", "ממתין לאישור"],
  ["home", "בית"],
  ["add", "הוספת חבילה"],
  ["pickup", "אני נוסע לאסוף"],
  ["catalog", "איסוף בחנות"],
  ["arrival", "מסירה בקיבוץ"],
  ["admin", "ניהול"],
];

function hasJoinPreviewParam() {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  return params.get("freshUser") === "1" || params.get("joinPreview") === "1";
}

function statusLabel(status: PackageStatus) {
  switch (status) {
    case "waiting":
      return "ממתין לאיסוף";
    case "assigned":
      return "ממתין לאיסוף";
    case "collected":
      return "נאספה";
    case "arrived":
      return "בקיבוץ";
    case "ready_for_handoff":
      return "ממתינה למסירה";
    case "delivered":
      return "נמסרה";
    case "cancelled":
      return "בוטלה";
  }
}

function statusBadgeClass(status: PackageStatus) {
  if (status === "collected") return "badge blue";
  if (status === "arrived" || status === "ready_for_handoff" || status === "delivered") return "badge done";
  if (status === "cancelled") return "badge danger";
  return "badge waiting";
}

function packageDetailBadge(pkg: DeliveryPackage) {
  switch (pkg.status) {
    case "waiting":
    case "assigned":
      return {
        className: "badge locked",
        icon: <Lock />,
        text: "פרטי איסוף מוגנים",
      };
    case "collected":
      return {
        className: "badge blue",
        icon: null,
        text: "בדרך לקיבוץ",
      };
    case "arrived":
    case "ready_for_handoff":
      return {
        className: "badge done",
        icon: null,
        text: pkg.currentKibbutzLocationText ?? "מיקום בקיבוץ לא צוין",
      };
    case "delivered":
      return {
        className: "badge done",
        icon: null,
        text: "נמסרה לבעל החבילה",
      };
    case "cancelled":
      return {
        className: "badge danger",
        icon: null,
        text: "לא פעילה",
      };
  }
}

function getLocationName(locations: PickupLocation[], id: string) {
  return locations.find((location) => location.id === id)?.name ?? "נקודה לא ידועה";
}

function getUserName(users: AppState["users"], id?: string) {
  return id ? users.find((user) => user.id === id)?.fullName : undefined;
}

function formatHebrewDate(isoDate?: string) {
  if (!isoDate) return "";

  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(isoDate));
}

export function LahavPackagesApp() {
  const [state, setState] = useState<AppState>(initialAppState);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [isSubmittingJoinRequest, setIsSubmittingJoinRequest] = useState(false);
  const [isSavingPackage, setIsSavingPackage] = useState(false);
  const [isStartingPickupRun, setIsStartingPickupRun] = useState(false);
  const [collectingPackageId, setCollectingPackageId] = useState<string | null>(null);
  const [adminActionId, setAdminActionId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(() => (hasJoinPreviewParam() ? "join" : "home"));
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPackage>(emptyDraft);
  const [joinDraft, setJoinDraft] = useState<JoinDraft>(initialJoinDraft);
  const [submittedJoinRequestId, setSubmittedJoinRequestId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [revealedSensitiveDetails, setRevealedSensitiveDetails] =
    useState<RevealedSensitivePackageDetails>({});
  const [pendingUnlockLocationId, setPendingUnlockLocationId] = useState<string | null>(null);
  const [hoursLocationId, setHoursLocationId] = useState<string | null>(null);
  const [pendingUnlockAnchor, setPendingUnlockAnchor] = useState<UnlockAnchor | null>(null);
  const [homeLocationFilterId, setHomeLocationFilterId] = useState<string | null>(null);
  const [joinPreviewMode, setJoinPreviewMode] = useState(() => hasJoinPreviewParam());
  const [dropLocation, setDropLocation] = useState<KibbutzDropLocation>("gate-crate");
  const [dropNote, setDropNote] = useState("שלוש החבילות בדולב, בצד ימין למעלה.");
  const pickupLocationStripRef = useRef<HTMLDivElement | null>(null);
  const pickupLocationArrowRef = useRef<HTMLButtonElement | null>(null);
  const ozPendingRecoveryRef = useRef<string | null>(null);
  const firebaseEnabled = hasFirebaseConfig();
  const currentUser = state.currentUser;
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
    const url = new URL(window.location.href);
    const shouldPreviewJoin =
      url.searchParams.get("freshUser") === "1" || url.searchParams.get("joinPreview") === "1";

    if (!shouldPreviewJoin) return;

    url.searchParams.delete("freshUser");
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
      if (savedState) setState(savedState);
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
      setState,
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

  const waitingPackages = state.packages.filter((pkg) => pkg.status === "waiting");
  const collectedPackages = state.packages.filter((pkg) => pkg.status === "collected");
  const arrivedPackages = state.packages.filter(
    (pkg) => pkg.status === "arrived" || pkg.status === "ready_for_handoff",
  );
  const deliveredPackages = state.packages.filter((pkg) => pkg.status === "delivered");
  const visibleHomePackages = homeLocationFilterId
    ? state.packages.filter((pkg) => pkg.pickupLocationId === homeLocationFilterId)
    : state.packages;
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

  const pendingJoinRequests = state.joinRequests.filter(
    (request) =>
      request.status === "pending" &&
      !(
        isOzAdminShortcut(request) &&
        request.userId === currentUserId &&
        (currentUser.role === "admin" || currentUser.role === "owner")
      ),
  );
  const submittedJoinRequest =
    state.joinRequests.find((request) => request.id === submittedJoinRequestId) ??
    pendingJoinRequests[0];
  const canManageCommunity =
    !joinPreviewMode && (currentUser.role === "admin" || currentUser.role === "owner");
  const effectiveScreen: Screen =
    screen === "pending" && submittedJoinRequest?.status === "approved"
      ? "home"
      : screen === "admin" && !canManageCommunity
        ? "home"
        : screen;

  const navItems: Array<[Screen, string, ReactNode]> = [
    ["home", "בית", <Home key="home" />],
    ["add", "הוספה", <PlusCircle key="add" />],
    ["pickup", "איסוף", <Route key="pickup" />],
    ...(canManageCommunity
      ? ([["admin", "ניהול", <Settings key="admin" />]] as Array<[Screen, string, ReactNode]>)
      : []),
  ];
  const visibleScreenLabels = canManageCommunity
    ? screenLabels
    : screenLabels.filter(([itemScreen]) => itemScreen !== "admin");

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
          setState(result.state);
        }
        setSubmittedJoinRequestId(result.requestId);
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
    showMark?: boolean;
  } {
    switch (effectiveScreen) {
      case "home":
        return { title: appName, showBell: true, showMark: true };
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
    try {
      const waitingCount = await operationsRepository.getWaitingPackageCount(state, locationId);

      if (waitingCount === 0) {
        setPendingUnlockLocationId(null);
        setPendingUnlockAnchor(null);
        notify("אין כרגע חבילות שממתינות לאיסוף בנקודה הזאת.");
        return;
      }

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

  async function submitJoinRequest() {
    const fullName = joinDraft.fullName.trim();
    const phone = joinDraft.phone.trim();
    const note = joinDraft.note.trim();

    if (isSubmittingJoinRequest) return;

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
        setState(result.state);
      }
      setSubmittedJoinRequestId(result.requestId);
      if (isOzAdmin) {
        setJoinPreviewMode(false);
      }
      setScreen(isOzAdmin ? "home" : "pending");
      notify(
        isOzAdmin
          ? "זוהית כמנהל. הרשאת הניהול פעילה."
          : "בקשת ההצטרפות נשלחה לאישור מנהל.",
      );
    } catch {
      notify("לא הצלחנו לשלוח את בקשת ההצטרפות. נסה/י שוב בעוד רגע.");
    } finally {
      setIsSubmittingJoinRequest(false);
    }
  }

  async function saveDraftPackage() {
    if (isSavingPackage) return;

    setIsSavingPackage(true);
    try {
      const result = await operationsRepository.createPackage(
        state,
        {
          ownerName: draft.ownerName,
          pickupLocationId: draft.pickupLocationId,
          sensitiveDeliveryMessage: draft.sensitiveDeliveryMessage,
        },
        actionDeps,
      );
      applyRepositoryState(result.state);
      setDraft(emptyDraft);
      setScreen("home");
      notify("החבילה נשמרה והפרטים הרגישים מוגנים.");
    } catch {
      notify("לא הצלחנו לשמור את החבילה. נסה/י שוב בעוד רגע.");
    } finally {
      setIsSavingPackage(false);
    }
  }

  async function startPickupRun(locationId: string) {
    if (isStartingPickupRun) return;

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
    void logSensitiveAccess(packageId, "open_pickup_link");
    notify("קישור האישור נפתח והפעולה נרשמה בלוג.");
  }

  function applyRepositoryState(nextState: AppState | void) {
    if (nextState) setState(nextState);
  }

  async function markCollected(packageId: string) {
    if (collectingPackageId) return;

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

  function updateArrival() {
    setState(
      updateCollectedPackagesArrival(
        state,
        {
          dropLocation,
          dropNote,
        },
        actionDeps,
      ),
    );
    setScreen("home");
    notify("מיקום החבילות בקיבוץ עודכן.");
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
    } catch {
      notify("לא הצלחנו לאשר את המשתמש. נסה/י שוב בעוד רגע.");
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
      const nextState = await operationsRepository.promoteUser(state, userId);
      applyRepositoryState(nextState);
      notify("הרשאת מנהל ניתנה.");
    } catch {
      notify("לא הצלחנו לתת הרשאת מנהל. נסה/י שוב בעוד רגע.");
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
              <span>להב</span>
            </div>
            <header className="app-header">
              <div className="header-row">
                <div className="header-side header-left">
                  {headerConfig.backTarget ? (
                    <button
                      className="icon-button"
                      onClick={() => setScreen(headerConfig.backTarget as Screen)}
                      type="button"
                      aria-label="חזרה"
                    >
                      <ArrowLeft />
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
                    <div className="brand-mark" aria-hidden="true" />
                  ) : null}
                </div>
              </div>
            </header>
          </div>

          <section className={`content content-${effectiveScreen}`}>{renderScreen()}</section>

          <nav className="bottom-nav" aria-label="ניווט ראשי">
            {navItems.map(([itemScreen, label, icon]) => (
              <button
                className={`nav-item nav-${itemScreen} ${effectiveScreen === itemScreen ? "active" : ""}`}
                key={itemScreen}
                onClick={() => setScreen(itemScreen)}
                type="button"
              >
                <span className="nav-icon">{icon}</span>
                <span className="nav-label">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </section>

      <aside className="desktop-panel" aria-label="פאנל בדיקה">
        <section className="panel-block">
          <h1>{appName}</h1>
          <p>
            יישום ראשון של המוצר: הצטרפות באישור מנהל, הוספת חבילה עם הודעת
            משלוח מקורית, איסוף בחנות לפי נקודה, ולוג גישה לפרטים מוגנים.
          </p>
        </section>

        <section className="panel-block tab-grid" aria-label="מעבר בין מסכים">
          {visibleScreenLabels.map(([itemScreen, label]) => (
            <button
              className={`tab-button ${effectiveScreen === itemScreen ? "active" : ""}`}
              key={itemScreen}
              onClick={() => setScreen(itemScreen)}
              type="button"
            >
              {label}
            </button>
          ))}
        </section>

        <section className="flow-grid">
          <FlowStep title="אימות">
            משתמש חדש מאמת טלפון ונכנס להמתנה עד שמנהל מאשר אותו.
          </FlowStep>
          <FlowStep title="הוספת חבילה">
            בעל חבילה מדביק את ההודעה המקורית. הקישור והקוד נשמרים מוגנים.
          </FlowStep>
          <FlowStep title="איסוף">
            אוסף בוחר נקודת איסוף ומקבל קטלוג חבילות רלוונטי בלבד.
          </FlowStep>
          <FlowStep title="אבטחה">
            פתיחת הודעה מקורית או קישור אישור נרשמת בלוג גישה.
          </FlowStep>
          <FlowStep title="מסירה">
            אחרי האיסוף מעדכנים איפה החבילות הונחו בקיבוץ.
          </FlowStep>
          <FlowStep title="Firebase">
            כרגע רץ במצב demo מקומי; קבצי Firebase מוכנים לחיבור פרויקט אמיתי.
          </FlowStep>
        </section>
      </aside>

      {toast ? (
        <div className="toast" dir="rtl" role="status" aria-live="polite">
          {toast}
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
            <div className="hours-summary">{hoursLocation.openingHours}</div>
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
    </main>
  );

  function renderScreen() {
    switch (effectiveScreen) {
      case "join":
        return (
          <JoinScreen
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
          <h1 className="screen-title">מה מצב החבילות?</h1>

          <div className="summary-grid" aria-label="סיכום">
            <div className="metric">
              <strong>{waitingPackages.length}</strong>
              <span>ממתינות לאיסוף</span>
            </div>
            <div className="metric">
              <strong>{collectedPackages.length}</strong>
              <span>בדרך לקיבוץ</span>
            </div>
            <div className="metric">
              <strong>{arrivedPackages.length}</strong>
              <span>ממתינות למסירה</span>
            </div>
            <div className="metric">
              <strong>{deliveredPackages.length}</strong>
              <span>נמסרו</span>
            </div>
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
                const selectLocation = () => {
                  setHomeLocationFilterId(location.id);
                  if (locationPackageCount > 0) {
                    void requestPickupUnlock(location.id);
                  }
                };
                return (
                  <div className="pickup-card-group" key={location.id}>
                    <div
                      aria-label={`${location.name}, ${locationPackageCount} חבילות ממתינות`}
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
                        setHomeLocationFilterId(location.id);
                        if (locationPackageCount > 0) {
                          void requestPickupUnlock(location.id, event.currentTarget);
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
                      <span>{location.name}</span>
                      <strong>{locationPackageCount}</strong>
                    </div>
                    <button
                      aria-label={`שעות פתיחה - ${location.name}`}
                      className={`opening-hours-icon-button opening-hours-icon-${openState}`}
                      onClick={() => setHoursLocationId(location.id)}
                      title="שעות פתיחה"
                      type="button"
                    />
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
              <div className="card empty-state">אין חבילות להצגה בנקודת האיסוף הזאת.</div>
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

        <form className="stack" onSubmit={(event) => event.preventDefault()}>
          <div className="field">
            <label htmlFor="owner">שם מקבל החבילה</label>
            <input
              id="owner"
              placeholder="הקלד/י שם מלא"
              value={draft.ownerName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, ownerName: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="pickup-location">בחר/י נקודת איסוף</label>
            <select
              id="pickup-location"
              value={draft.pickupLocationId}
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
          </div>
          <div className="field">
            <label htmlFor="message">הודעת חברת משלוחים מקורית</label>
            <textarea
              id="message"
              placeholder="הדבק/י כאן את ההודעה המקורית שקיבלת מחברת המשלוחים"
              value={draft.sensitiveDeliveryMessage}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  sensitiveDeliveryMessage: event.target.value,
                }))
              }
            />
          </div>
          <div className="security-note">
            <Lock />
            <span>ההודעה שמורה בצורה מאובטחת ורק מי שאוסף יוכל לראות אותה.</span>
          </div>
          <button
            className="button primary full"
            disabled={isSavingPackage}
            onClick={saveDraftPackage}
            type="button"
          >
            <Save />
            {isSavingPackage ? "שומר..." : "שמור"}
          </button>
        </form>
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
            return (
              <button
                className="location-button"
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
      (pkg) => pkg.status === "collected" && pkg.collectorUserId === state.currentUser.id,
    );

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
            {packagesCollectedByCurrentUser.length ? (
              <div className="collected-list">
                {packagesCollectedByCurrentUser.map((pkg) => (
                  <div className="collected-row" key={pkg.id}>
                    <strong>{pkg.ownerName}</strong>
                    <span>{getLocationName(state.pickupLocations, pkg.pickupLocationId)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="drop-location">איפה השארת את החבילות?</label>
            <select
              id="drop-location"
              value={dropLocation}
              onChange={(event) => setDropLocation(event.target.value as KibbutzDropLocation)}
            >
              <option value="gate-crate">בדולב בש.ג</option>
              <option value="kolbo">בכלבו</option>
              <option value="collector-home">אצלי בבית</option>
              <option value="direct-home">נמסרה ישירות לבית המקבל</option>
              <option value="other">אחר</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="drop-note">הערה למסירה</label>
            <textarea
              id="drop-note"
              value={dropNote}
              onChange={(event) => setDropNote(event.target.value)}
            />
          </div>
          <button className="button primary full" onClick={updateArrival} type="button">
            <MapPinCheck />
            עדכן מיקום ושלח התראות
          </button>
        </div>
      </>
    );
  }

  function AdminScreen() {
    const promotableUsers = state.users.filter(
      (user) => user.role === "member" && user.verificationStatus === "approved",
    );

    return (
      <>
        <h1 className="screen-title">ניהול קהילה</h1>
        <p className="screen-kicker">בקשות הצטרפות, הרשאות מנהל ונקודות איסוף.</p>

        <div className="summary-grid" aria-label="סיכום מנהל">
          <div className="metric">
            <strong>{pendingJoinRequests.length}</strong>
            <span>ממתינים</span>
          </div>
          <div className="metric">
            <strong>{state.users.length}</strong>
            <span>מאושרים</span>
          </div>
          <div className="metric">
            <strong>{state.users.filter((user) => user.role !== "member").length}</strong>
            <span>מנהלים</span>
          </div>
        </div>

        <div className="stack">
          {pendingJoinRequests.map((request) => (
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
          ))}

          {promotableUsers.map((user) => (
            <div className="admin-card" key={user.id}>
              <div className="package-top">
                <div>
                  <div className="package-name">{user.fullName}</div>
                  <div className="package-meta">{user.phone} · חברה רגילה</div>
                </div>
                <span className="badge done">מאושרת</span>
              </div>
              <button
                className="button full"
                disabled={adminActionId !== null}
                onClick={() => promoteUser(user.id)}
                type="button"
              >
                <ShieldPlus />
                {adminActionId === `promote-${user.id}` ? "מעדכן הרשאה..." : "הענק הרשאת מנהל"}
              </button>
            </div>
          ))}
        </div>
      </>
    );
  }

  function PackageCard({ pkg }: { pkg: DeliveryPackage }) {
    const collectorName = getUserName(state.users, pkg.collectorUserId);
    const detailBadge = packageDetailBadge(pkg);
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
            <span className={statusBadgeClass(pkg.status)}>{statusLabel(pkg.status)}</span>
          </div>
          {pkg.status !== "waiting" && pkg.status !== "assigned" ? (
            <span className={detailBadge.className}>
              {detailBadge.icon}
              {detailBadge.text}
            </span>
          ) : null}
          {collectorName && wasCollected ? (
            <div className="package-note">נאספה על ידי {collectorName}</div>
          ) : null}
        </div>
      </div>
    );
  }

  function OriginalMessageText({ pkg }: { pkg: DeliveryPackage }) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const fullUrlPattern = /^https?:\/\/[^\s]+$/;
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
            {isCollected ? "נאספה" : "ממתין לאיסוף"}
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
          <button
            aria-pressed={isCollected}
            className={`button collect-button ${isCollected ? "checked" : ""}`}
            disabled={isCollected || collectingPackageId !== null}
            onClick={() => markCollected(pkg.id)}
            type="button"
          >
            <span className="collect-checkbox-mark" aria-hidden="true">
              {isCollected ? <Check /> : null}
            </span>
            {isCollecting ? "מסמן..." : "נאספה"}
          </button>
        </div>
      </div>
    );
  }
}

function JoinScreen({
  isSubmitting,
  joinDraft,
  onChange,
  onPending,
}: {
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
          disabled={isSubmitting}
          onClick={onPending}
          type="button"
        >
          <Send />
          {isSubmitting ? "שולח בקשה..." : "שלח בקשת הצטרפות"}
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

function FlowStep({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flow-step">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

