import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3002";

function webServerEnv() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return {
    ...env,
    NEXT_PUBLIC_FORCE_LOCAL_DEMO: "1",
    NEXT_PUBLIC_FIREBASE_API_KEY: "",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
    NEXT_PUBLIC_FIREBASE_APP_ID: "",
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 414, height: 896 },
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3002",
        env: webServerEnv(),
        reuseExistingServer: true,
        timeout: 120_000,
        url: baseURL,
      },
});
