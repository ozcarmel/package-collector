"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LahavPackagesApp } from "@/components/lahav-packages-app";

function subscribe() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function getServiceWorkerPath() {
  const basePath = window.location.pathname.startsWith("/package-collector")
    ? "/package-collector"
    : "";

  return {
    scope: `${basePath}/`,
    scriptUrl: `${basePath}/sw.js`,
  };
}

function useAppServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    async function registerServiceWorker() {
      const { scope, scriptUrl } = getServiceWorkerPath();
      const registration = await navigator.serviceWorker.register(scriptUrl, { scope });
      if (!cancelled) {
        await registration.update();
      }
    }

    registerServiceWorker().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);
}

function useVisualViewportSizing() {
  useEffect(() => {
    let animationFrame = 0;

    function updateAppViewport() {
      cancelAnimationFrame(animationFrame);

      animationFrame = window.requestAnimationFrame(() => {
        const visualViewport = window.visualViewport;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportTop = visualViewport?.offsetTop ?? 0;

        document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
        document.documentElement.style.setProperty("--app-top", `${Math.round(viewportTop)}px`);
      });
    }

    updateAppViewport();

    window.addEventListener("resize", updateAppViewport);
    window.addEventListener("orientationchange", updateAppViewport);
    window.visualViewport?.addEventListener("resize", updateAppViewport);
    window.visualViewport?.addEventListener("scroll", updateAppViewport);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateAppViewport);
      window.removeEventListener("orientationchange", updateAppViewport);
      window.visualViewport?.removeEventListener("resize", updateAppViewport);
      window.visualViewport?.removeEventListener("scroll", updateAppViewport);
    };
  }, []);
}

export function ClientHome() {
  useVisualViewportSizing();
  useAppServiceWorker();

  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) return null;

  return <LahavPackagesApp />;
}
