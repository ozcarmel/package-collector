import { describe, expect, it } from "vitest";
import { shouldShowStartupLoading } from "@/lib/startup-readiness";

const subscriptionKey = "user-1:member:approved";

function readiness(
  overrides: Partial<Parameters<typeof shouldShowStartupLoading>[0]> = {},
) {
  return shouldShowStartupLoading({
    firebaseEnabled: true,
    joinPreviewMode: false,
    sessionReady: true,
    subscriptionKey,
    loadedSubscriptionKey: subscriptionKey,
    ...overrides,
  });
}

describe("startup readiness", () => {
  it("keeps loading while the Firebase user is unresolved", () => {
    expect(readiness({ sessionReady: false, loadedSubscriptionKey: null })).toBe(true);
  });

  it("keeps loading after authentication until the first app state arrives", () => {
    expect(readiness({ loadedSubscriptionKey: null })).toBe(true);
  });

  it("allows Home to render after the matching app state arrives, including a truly empty state", () => {
    expect(readiness()).toBe(false);
  });

  it("does not reopen loading during later refreshes for the same subscription", () => {
    expect(readiness({ loadedSubscriptionKey: subscriptionKey })).toBe(false);
  });

  it("stays loading after an initial failure and resolves after a successful retry", () => {
    expect(readiness({ loadedSubscriptionKey: null })).toBe(true);
    expect(readiness({ loadedSubscriptionKey: subscriptionKey })).toBe(false);
  });

  it("requires a fresh state when the user's approval or role changes", () => {
    expect(
      readiness({
        subscriptionKey: "user-1:member:approved",
        loadedSubscriptionKey: "user-1:member:phone_pending",
      }),
    ).toBe(true);
  });

  it("does not block local demo or explicit join-preview mode", () => {
    expect(readiness({ firebaseEnabled: false, loadedSubscriptionKey: null })).toBe(false);
    expect(readiness({ joinPreviewMode: true, loadedSubscriptionKey: null })).toBe(false);
  });
});
