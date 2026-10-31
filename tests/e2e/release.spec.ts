import { expect, test } from "@playwright/test";
import { Client } from "pg";

const password = "ChoiceFatigue-test-password-2026";

async function resetE2eDatabase() {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) throw new Error("E2E_DATABASE_URL must point to the disposable Playwright database.");
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith("_e2e")) throw new Error("Refusing to reset a database that is not explicitly named *_e2e.");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE table_names text;
      BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
          INTO table_names
          FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
        IF table_names IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE ' || table_names || ' RESTART IDENTITY CASCADE';
        END IF;
      END $$;
    `);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ request }) => {
  await resetE2eDatabase();
  await request.post("http://127.0.0.1:4199/__control", { data: { reset: true } });
});

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
  test.setTimeout(180_000);
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

  const resolvedMetadata = await page.evaluate(async () => fetch("/api/media/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ["tmdb-movie-101", "theporndb-scene-adult-scene-1"] }),
  }).then(response => response.json()));
  expect(resolvedMetadata.items.map((item: { id: string }) => item.id)).toEqual(["tmdb-movie-101", "theporndb-scene-adult-scene-1"]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Movies", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mock Movie One" })).toBeVisible();
  await page.locator(".card-active .card-poster").click();
  await expect(page.getByRole("dialog", { name: "Mock Movie One" })).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Want to see it, right arrow key" }).click();
  await expect(page.getByText("1 title in the maybe pile")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 1, decisionCount: 1 });
  await page.getByRole("button", { name: "Undo last choice" }).first().click();
  await expect(page.getByText("0 titles in the maybe pile")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 0, decisionCount: 0 });
  await page.getByRole("button", { name: "Want to see it, right arrow key" }).click();
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
  await page.getByRole("radio", { name: "10 out of 10" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Movies", exact: true })).toBeVisible();

  const exportData = await page.evaluate(async () => (await fetch("/api/account/export")).json());
  expect(exportData.format).toBe("choice-fatigue-account-export-v3");
  expect(JSON.stringify(exportData.recommendationHistory)).not.toContain("Mock Movie One");
  expect(JSON.stringify(exportData.discovery.state)).not.toContain("Mock Movie One");
  expect(exportData.recommendationHistory.some((row: { candidateIds?: string[] }) => row.candidateIds?.includes("tmdb-movie-101"))).toBe(true);

  await request.post("http://127.0.0.1:4199/__control", { data: { emptyTmdb: true } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No popular titles are available right now." })).toBeVisible();
  await page.getByRole("button", { name: /^Saved/ }).click();
  await expect(page.getByRole("dialog").getByText("Mock Movie One").first()).toBeVisible();
  await page.getByRole("button", { name: "Close saved titles" }).click();
  await request.post("http://127.0.0.1:4199/__control", { data: { emptyTmdb: false } });

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
  await expect(page.getByRole("heading", { name: "Mock Adult Scene" })).toBeVisible();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "metadata source is temporarily unavailable" })).toBeVisible();
  await request.post("http://127.0.0.1:4199/__control", { data: { failTmdb: false } });
  await request.post("http://127.0.0.1:4199/__control", { data: { malformedAdult: true } });
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => fetch("/api/discovery-state", { cache: "no-store" }).then(response => response.json()).then(state => state.category))).toBe("Movies");
  await page.goto("/");
  await request.post("http://127.0.0.1:4199/__control", { data: { malformedAdult: false } });

  const tmdbDisabled = await page.evaluate(async () => fetch("/api/admin/providers/tmdb/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "", enabled: false }) }).then(response => response.status));
  expect(tmdbDisabled).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A metadata source needs setup." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Configure metadata sources" })).toBeVisible();
  const tmdbEnabled = await page.evaluate(async () => fetch("/api/admin/providers/tmdb/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "", enabled: true }) }).then(response => response.status));
  expect(tmdbEnabled).toBe(200);

  await request.post("http://127.0.0.1:4199/__control", { data: { failTmdb: true } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This metadata source is temporarily unavailable." })).toBeVisible();
  await request.post("http://127.0.0.1:4199/__control", { data: { failTmdb: false } });
  await page.goto("/");

  const concurrentWrite = await page.evaluate(async () => {
    const firstRead = await fetch("/api/discovery-state", { cache: "no-store" });
    const base = await firstRead.json();
    const revision = firstRead.headers.get("x-discovery-state-revision")!;
    const first = { ...base, saved: [...base.saved, "tmdb-movie-998"] };
    const stale = { ...base, shortlisted: [...base.shortlisted, "tmdb-movie-999"] };
    const firstWrite = await fetch("/api/discovery-state", { method: "PUT", headers: { "content-type": "application/json", "x-discovery-state-revision": revision }, body: JSON.stringify(first) });
    const staleWrite = await fetch("/api/discovery-state", { method: "PUT", headers: { "content-type": "application/json", "x-discovery-state-revision": revision }, body: JSON.stringify(stale) });
    return { firstStatus: firstWrite.status, staleStatus: staleWrite.status, baseSessionId: base.sessionId };
  });
  expect(concurrentWrite.firstStatus).toBe(200);
  expect(concurrentWrite.staleStatus).toBe(409);
  const persistedAfterConflict = await page.evaluate(async () => fetch("/api/discovery-state", { cache: "no-store" }).then(response => response.json()));
  expect(persistedAfterConflict.sessionId).toBe(concurrentWrite.baseSessionId);
  expect(persistedAfterConflict.saved).toContain("tmdb-movie-998");
  expect(persistedAfterConflict.shortlisted).not.toContain("tmdb-movie-999");

  await memberPage.goto("/account");
  await memberPage.getByLabel("Type DELETE to confirm").fill("DELETE");
  await memberPage.getByLabel("Password").fill(password);
  const deletionResponse = memberPage.waitForResponse(response => response.url().includes("/api/auth/delete-user"), { timeout: 20_000 });
  await memberPage.getByRole("button", { name: "Permanently delete account" }).click();
  expect((await deletionResponse).status()).toBe(200);
  await expect(memberPage).toHaveURL(/sign-in/);
  await memberContext.close();
});

test("private account APIs reject anonymous access", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4173/api/discovery-state");
  expect(response.status()).toBe(401);
});

async function setupRecommendationAdmin(page: import("@playwright/test").Page) {
  await page.goto("/sign-up");
  await page.locator('input[name="name"]').fill("Recommendation Admin");
  await page.locator('input[name="email"]').fill("recommendations@example.test");
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.goto("/admin");
  await configure(page);
}

function learningDecision(itemId: string, index: number, decision: "keep" | "pass" = "keep", category: "Movies" | "Adult" = "Movies") {
  return { id: `seed-${category}-${index}`, sessionId: "seed", sequence: index, occurredAt: new Date(Date.UTC(2026, 9, 31, 8, 0, index)).toISOString(), itemId, category, eventType: "decision", decision, rating: null, reviewId: null, targetEventId: null, candidateIds: null, algorithmVersion: "content-v3", retrievalId: null, source: null, lane: null };
}

test("reranking preserves actual shown order and invalid events do not block valid choices", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await request.post("http://127.0.0.1:4199/__control", { data: { extended: true } });
  await page.goto("/");
  await expect(page.locator(".card-active h2")).toHaveText("Paged Movie 101");
  const box = await page.locator(".card-active").boundingBox();
  if (!box) throw new Error("Missing active card");
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".card-active h2")).toHaveText("Paged Movie 102");
  await expect.poll(async () => page.evaluate(async () => {
    const data = await (await fetch("/api/recommendation-events?category=Movies")).json();
    return data.events.some((event: { eventType: string; itemId: string; candidateIds: string[] }) => event.eventType === "item_shown" && event.itemId === "tmdb-movie-102" && event.candidateIds[0] === "tmdb-movie-102");
  })).toBe(true);
  const valid = learningDecision("tmdb-movie-900", 0);
  const posted = await page.evaluate(async valid => {
    const invalid = { ...valid, id: "invalid-trace", eventType: "item_shown", decision: null, candidateIds: ["tmdb-movie-901"] };
    return (await fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [invalid, valid] }) })).json();
  }, valid);
  expect(posted.acceptedIds).toEqual([valid.id]);
  expect(posted.rejected).toMatchObject([{ id: "invalid-trace", code: "invalid" }]);
  await page.getByRole("button", { name: "Want to see it, right arrow key" }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const data = await (await fetch("/api/account/export")).json();
    return data.recommendationHistory.some((event: { eventType: string; itemId: string; decision: string }) => event.eventType === "decision" && event.itemId === "tmdb-movie-102" && event.decision === "keep");
  })).toBe(true);
  await expect(page.getByText(/recommendation events were rejected/)).toHaveCount(0);
});

test("paging past 100 accumulated candidates keeps traces bounded and learning usable", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await request.post("http://127.0.0.1:4199/__control", { data: { extended: true } });
  const past = Array.from({ length: 105 }, (_, index) => learningDecision(`tmdb-movie-${101 + index}`, index, "pass"));
  const accepted = await page.evaluate(async events => (await fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) })).json(), past);
  expect(accepted.acceptedIds).toHaveLength(105);
  await page.goto("/");
  await expect(page.locator(".card-active h2")).toContainText(/Paged Movie 2\d\d/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Want to see it, right arrow key" }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const data = await (await fetch("/api/account/export")).json();
    return data.recommendationHistory.filter((event: { eventType: string; decision: string }) => event.eventType === "decision" && event.decision === "keep").length;
  })).toBe(1);
  const traces = await page.evaluate(async () => {
    const data = await (await fetch("/api/account/export")).json();
    return data.recommendationHistory.filter((event: { category: string; candidateIds: string[] | null }) => event.category === "Movies" && event.candidateIds);
  });
  expect(traces.every((event: { candidateIds: string[] }) => event.candidateIds.length <= 100)).toBe(true);
  expect(new Set(traces.filter((event: { eventType: string }) => event.eventType === "candidate_batch").flatMap((event: { candidateIds: string[] }) => event.candidateIds)).size).toBeGreaterThan(100);
});

test("profiles retrieve niche candidates, Adult access gates hydration, and provider failures are isolated", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  const cold = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(cold.items.some((item: { id: string }) => item.id === "tmdb-movie-9001")).toBe(false);
  const seed = [901, 902, 903].map((id, index) => learningDecision(`tmdb-movie-${id}`, index));
  await page.evaluate(async events => fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }), seed);
  const personalized = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(personalized.items.some((item: { id: string }) => item.id === "tmdb-movie-9001")).toBe(true);
  expect(personalized.batches.some((batch: { lane: string }) => batch.lane === "personalized")).toBe(true);
  expect(await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Adult")).status)).toBe(403);
  expect(await page.evaluate(async () => (await fetch("/api/recommendation-events?category=Adult")).status)).toBe(403);
  const beforeGrant = await (await request.get("http://127.0.0.1:4199/__control")).json();
  expect(beforeGrant.requests.some((entry: { path: string }) => entry.path === "/graphql" || entry.path.startsWith("/theporndb"))).toBe(false);
  await page.evaluate(async () => {
    const users = (await (await fetch("/api/admin/users")).json()).users;
    const user = users.find((user: { email: string }) => user.email === "recommendations@example.test");
    await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.id, adultAllowed: true }) });
  });
  const adultSeed = [1, 2, 3].map((id, index) => learningDecision(`stashdb-stash-history-${id}`, index, "keep", "Adult"));
  await page.evaluate(async events => fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }), adultSeed);
  await request.post("http://127.0.0.1:4199/__control", { data: { extended: true } });
  const adult = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Adult")).json());
  expect(adult.items.some((item: { id: string }) => item.id === "stashdb-stash-personalized")).toBe(true);
  expect(adult.cursor).toBeTruthy();
  const next = await page.evaluate(async cursor => (await fetch(`/api/discovery-feed?category=Adult&cursor=${encodeURIComponent(cursor)}`)).json(), adult.cursor);
  expect(next.items.some((item: { id: string }) => item.id === "theporndb-scene-adult-scene-26")).toBe(true);
  expect(next.items.some((item: { id: string }) => item.id === "stashdb-stash-scene-26")).toBe(true);
  const sources = await (await request.get("http://127.0.0.1:4199/__control")).json();
  expect(sources.requests.some((entry: { input?: { input?: { tags?: { modifier: string; value: string[] } } } }) => entry.input?.input?.tags?.modifier === "INCLUDES" && entry.input.input.tags.value.includes("tag-drama"))).toBe(true);
  await request.post("http://127.0.0.1:4199/__control", { data: { failMovies: true } });
  const shows = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Shows")).json());
  const movies = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(shows.items.length).toBeGreaterThan(0);
  expect(movies.status.outcome).toBe("unavailable");
});
