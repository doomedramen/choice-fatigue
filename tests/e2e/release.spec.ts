import { expect, test } from "@playwright/test";

const password = "ChoiceFatigue-test-password-2026";

async function waitForPersistedState(page: import("@playwright/test").Page, expected: { shortlistCount: number; decisionCount: number }) {
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/discovery-state", { cache: "no-store" });
    const state = await response.json();
    return { shortlistCount: state.shortlisted.length, decisionCount: Object.keys(state.decisions).length };
  }), { timeout: 15_000 }).toEqual(expected);
}

async function configure(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const settingsResponse = await fetch("/api/admin/settings");
    if (!settingsResponse.ok) throw new Error(`Could not read admin settings: ${settingsResponse.status}`);
    const current = await settingsResponse.json();
    const saved = await fetch("/api/admin/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ appName: current.appName, defaultCategory: "Movies", adultSectionEnabled: true, allowPrivateNetworkTargets: false, betaInviteCode: "playwright-invite", smtpEnabled: false, smtpFrom: "", smtpUrl: "", clearSmtpConfig: false }),
    });
    if (!saved.ok) throw new Error(`Could not save admin settings: ${saved.status}`);
    for (const [provider, apiKey] of [["tmdb", "mock-tmdb-token"], ["theporndb", "mock-theporndb-key"], ["stashdb", "mock-stashdb-key"]] as const) {
      const url = provider === "tmdb" ? "/api/admin/providers/tmdb/config" : `/api/admin/providers/${provider}/config`;
      const response = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey, enabled: true }) });
      if (!response.ok) throw new Error(`Could not configure ${provider}: ${response.status}`);
    }
  });
}

test("first run, account access, provider discovery, saved state and account controls", async ({ page, browser, request }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Set up Choice Fatigue." })).toBeVisible();
  await page.locator('input[name="name"]').fill("Release Admin");
  await page.locator('input[name="email"]').fill("release-admin@example.test");
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.goto("/admin");
  await configure(page);
  const adminUsers = await page.evaluate(async () => (await (await fetch("/api/admin/users")).json()).users);
  const admin = adminUsers.find((user: { email: string }) => user.email === "release-admin@example.test");
  expect(admin).toBeTruthy();
  const selfGrant = await page.evaluate(async (userId) => fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, adultAllowed: true }) }).then(response => response.status), admin.id);
  expect(selfGrant).toBe(200);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Movies", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mock Movie One" })).toBeVisible();
  await page.getByRole("button", { name: "Shortlist, right arrow key" }).click();
  await expect(page.getByText("1 title in the maybe pile")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 1, decisionCount: 1 });
  await page.getByRole("button", { name: "Undo last choice" }).first().click();
  await expect(page.getByText("0 titles in the maybe pile")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 0, decisionCount: 0 });
  await page.getByRole("button", { name: "Shortlist, right arrow key" }).click();
  await expect(page.getByText("1 title in the maybe pile")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 1, decisionCount: 1 });
  await page.reload();
  await expect(page.getByText("1 title in the maybe pile")).toBeVisible();
  await page.getByRole("button", { name: "Review & compare" }).click();
  await page.getByRole("button", { name: "Remove from shortlist" }).click();
  await expect(page.getByText("Removed for now")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Save 1 pick" }).click();
  await expect(page.getByRole("heading", { name: "Saved for later" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Mock Movie One").first()).toBeVisible();
  await page.getByRole("button", { name: "Close saved titles" }).click();
  await expect(page.getByRole("heading", { name: "Mock Movie Two" })).toBeVisible();
  await page.getByRole("button", { name: "Seen it: rate Mock Movie Two" }).click();
  await page.getByRole("radio", { name: "5 stars" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Movies", exact: true })).toBeVisible();

  const exportData = await page.evaluate(async () => (await fetch("/api/account/export")).json());
  expect(exportData.format).toBe("choice-fatigue-account-export-v3");
  expect(JSON.stringify(exportData.recommendationHistory)).not.toContain("Mock Movie One");
  expect(JSON.stringify(exportData.discovery.state)).not.toContain("Mock Movie One");
  expect(exportData.recommendationHistory.some((row: { candidateIds?: string[] }) => row.candidateIds?.includes("tmdb-movie-101"))).toBe(true);

  await page.getByRole("button", { name: "Adult", exact: true }).click();
  await page.getByRole("button", { name: "I’m 18 or older" }).click();
  await expect(page.getByRole("heading", { name: "Adult", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mock Adult Scene" })).toBeVisible();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/sign-up");
  await expect(memberPage.getByRole("heading", { name: "Create your account." })).toBeVisible();
  await memberPage.locator('input[name="name"]').fill("Release Member");
  await memberPage.locator('input[name="inviteCode"]').fill("playwright-invite");
  await memberPage.locator('input[name="email"]').fill("release-member@example.test");
  await memberPage.locator('input[name="password"]').fill(password);
  await memberPage.locator('input[name="confirmPassword"]').fill(password);
  await memberPage.getByRole("button", { name: "Create account" }).click();
  await expect(memberPage).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(memberPage.getByRole("button", { name: "Adult", exact: true })).toHaveCount(0);
  const memberState = await memberPage.evaluate(async () => fetch("/api/discovery-state", { cache: "no-store" }).then(response => response.json()));
  expect(memberState.shortlisted).toEqual([]);
  expect(memberState.saved).toEqual([]);
  expect(memberState.decisions).toEqual({});
  expect(await memberPage.evaluate(async () => fetch("/api/admin/users").then(response => response.status))).toBe(403);

  await page.goto("/admin");
  const member = await page.evaluate(async () => (await (await fetch("/api/admin/users")).json()).users.find((user: { email: string }) => user.email === "release-member@example.test"));
  const memberGrant = await page.evaluate(async (userId) => fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, adultAllowed: true }) }).then(response => response.status), member.id);
  expect(memberGrant).toBe(200);
  await memberPage.reload();
  await expect(memberPage.getByRole("button", { name: "Adult", exact: true })).toBeVisible();

  await page.goto("/account");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Clear recommendation history" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved recommendation history cleared" })).toBeVisible();

  const controlResponse = await request.post("http://127.0.0.1:4199/__control", { data: { failTmdb: true } });
  expect(controlResponse.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "metadata source is temporarily unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mock Adult Scene" })).toBeVisible();
  await request.post("http://127.0.0.1:4199/__control", { data: { failTmdb: false } });
  await request.post("http://127.0.0.1:4199/__control", { data: { malformedAdult: true } });
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mock Movie One" })).toBeVisible();
  await request.post("http://127.0.0.1:4199/__control", { data: { malformedAdult: false } });

  await memberPage.goto("/account");
  await memberPage.getByLabel("Type DELETE to confirm").fill("DELETE");
  await memberPage.getByLabel("Password").fill(password);
  await memberPage.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(memberPage).toHaveURL(/sign-in/);
  await memberContext.close();
});

test("private account APIs reject anonymous access", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4173/api/discovery-state");
  expect(response.status()).toBe(401);
});
