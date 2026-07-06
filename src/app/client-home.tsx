"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LahavPackagesApp } from "@/components/lahav-packages-app";

const staleServiceWorkerCleanupKey = "lahav-package-collector-sw-cleanup-20260706-mobile-shell-bump";

function subscribe() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function isPackageCollectorRegistration(registration: ServiceWorkerRegistration) {
  try {
    const scopeUrl = new URL(registration.scope);
    return scopeUrl.origin === window.location.origin && scopeUrl.pathname.includes("/package-collector");
  } catch {
    return false;
  }
}

function reloadWithFreshBundle() {
  if (window.sessionStorage.getItem(staleServiceWorkerCleanupKey)) return;

  window.sessionStorage.setItem(staleServiceWorkerCleanupKey, "1");
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString());
  window.location.replace(url.toString());
}

function useStaleServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "LAHAV_PACKAGE_COLLECTOR_SW_CLEANED") {
        reloadWithFreshBundle();
      }
    }

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", reloadWithFreshBundle);

    async function cleanupStaleRegistration() {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const appRegistrations = registrations.filter(isPackageCollectorRegistration);
      const controllerScriptUrl = navigator.serviceWorker.controller?.scriptURL ?? "";
      const hasRelevantController = controllerScriptUrl.includes("/package-collector/");

      if (!hasRelevantController && !appRegistrations.length) return;

      await Promise.all(appRegistrations.map((registration) => registration.unregister()));

      if ("caches" in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
      }

      if (!cancelled) {
        reloadWithFreshBundle();
      }
    }

    cleanupStaleRegistration().catch(() => undefined);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadWithFreshBundle);
    };
  }, []);
}

export function ClientHome() {
  useStaleServiceWorkerCleanup();

  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) return null;

  return <LahavPackagesApp />;
}
