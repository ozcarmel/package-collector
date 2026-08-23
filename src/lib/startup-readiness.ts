export interface StartupReadinessInput {
  firebaseEnabled: boolean;
  joinPreviewMode: boolean;
  sessionReady: boolean;
  subscriptionKey: string;
  loadedSubscriptionKey: string | null;
}

export function shouldShowStartupLoading({
  firebaseEnabled,
  joinPreviewMode,
  sessionReady,
  subscriptionKey,
  loadedSubscriptionKey,
}: StartupReadinessInput) {
  if (!firebaseEnabled || joinPreviewMode) return false;

  return !sessionReady || loadedSubscriptionKey !== subscriptionKey;
}
