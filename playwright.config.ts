import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:4173";
const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    { command: "pnpm exec tsx tests/e2e/metadata-stub.ts", url: "http://127.0.0.1:4199/__control", reuseExistingServer: false, env: { METADATA_STUB_PORT: "4199" } },
    {
      command: "pnpm dev",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: process.env.E2E_DATABASE_URL || "postgresql://choice_fatigue:choice_fatigue_dev@127.0.0.1:5432/choice_fatigue_e2e?schema=public",
        BETTER_AUTH_SECRET: "playwright-test-auth-secret-at-least-32-characters-long",
        BETTER_AUTH_URL: baseURL,
        INTEGRATION_CREDENTIALS_KEY: key,
        TMDB_API_BASE_URL: "http://127.0.0.1:4199/3",
        THEPORNDB_API_BASE_URL: "http://127.0.0.1:4199/theporndb",
        STASHDB_API_BASE_URL: "http://127.0.0.1:4199/graphql",
      },
    },
  ],
});
