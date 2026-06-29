"use client";

import { useSyncExternalStore } from "react";
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

export function ClientHome() {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) return null;

  return <LahavPackagesApp />;
}
