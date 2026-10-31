import { expect, test } from "@playwright/test";
import { Client } from "pg";

const password = "ChoiceFatigue-test-password-2026";

async function resetE2eDatabase() {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) throw new Error("E2E_DATABASE_URL must point to the disposable Playwright database.");
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname)) throw new Error("Refusing to connect to a non-local Playwright database.");
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
  const blocked = await page.evaluate(async () => (await fetch("/api/integrations/not-a-real-connection/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalogueEntryId: "tmdb-movie-101" }) })).status);
  expect(blocked).toBe(403);
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
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Cast" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Mock Actor")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("The Lead")).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
  await expect(page.getByText("1 title in your shortlist")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 1, decisionCount: 1 });
  await page.getByRole("button", { name: "Undo last choice" }).first().click();
  await expect(page.getByText("0 titles in your shortlist")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 0, decisionCount: 0 });
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
  await expect(page.getByText("1 title in your shortlist")).toBeVisible();
  await waitForPersistedState(page, { shortlistCount: 1, decisionCount: 1 });
  await page.reload();
  await expect(page.getByText("1 title in your shortlist")).toBeVisible();
  await page.getByRole("button", { name: "Review & compare" }).click();
  await page.getByRole("button", { name: "Remove from shortlist" }).click();
  await expect(page.getByText("Removed for now")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Save 1 title" }).click();
  await expect(page.getByRole("heading", { name: "Saved for later" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Mock Movie One").first()).toBeVisible();
  await page.getByRole("button", { name: "Close saved titles" }).click();
  await expect(page.getByRole("heading", { name: "Mock Movie Two" })).toBeVisible();
  await page.getByRole("button", { name: "Seen it: rate Mock Movie Two" }).click();
  await page.getByRole("button", { name: "10 out of 10", exact: true }).click();
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
  await page.getByRole("button", { name: "Clear recommendation history" }).click();
  await expect(page.getByRole("dialog", { name: "Clear recommendation history?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Clear history" }).click();
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
  const response = await request.get("/api/discovery-state");
  expect(response.status()).toBe(401);
  expect((await request.get("/api/media/people?id=tmdb-movie-101")).status()).toBe(401);
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
  return { id: `seed-${category}-${index}`, sessionId: "seed", sequence: index, occurredAt: new Date(Date.now() - 10 * 60_000 + index * 1000).toISOString(), itemId, category, eventType: "decision", decision, rating: null, reviewId: null, targetEventId: null, candidateIds: null, algorithmVersion: "content-v7", retrievalId: null, source: null, lane: null };
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
    const data = await (await fetch("/api/account/export")).json();
    return data.recommendationHistory.some((event: { eventType: string; itemId: string; candidateIds: string[] }) => event.eventType === "item_shown" && event.itemId === "tmdb-movie-102" && event.candidateIds[0] === "tmdb-movie-102");
  })).toBe(true);
  const valid = learningDecision("tmdb-movie-900", 0);
  const posted = await page.evaluate(async valid => {
    const invalid = { ...valid, id: "invalid-trace", eventType: "item_shown", decision: null, candidateIds: ["tmdb-movie-901"] };
    return (await fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [invalid, valid] }) })).json();
  }, valid);
  expect(posted.acceptedIds).toEqual([valid.id]);
  expect(posted.rejected).toMatchObject([{ id: "invalid-trace", code: "invalid" }]);
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
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
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
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
  expect(personalized.batches.some((batch: { lane: string }) => batch.lane === "person")).toBe(true);
  expect(personalized.batches.some((batch: { lane: string }) => batch.lane === "company")).toBe(true);
  expect(personalized.items.some((item: { id: string }) => item.id === "tmdb-movie-9930")).toBe(false);
  expect(personalized.batches.some((batch: { candidateIds: string[] }) => batch.candidateIds.includes("tmdb-movie-9930"))).toBe(false);
  expect(personalized.items.find((item: { id: string }) => item.id === "tmdb-movie-9931")?.rating).toBe("—");
  expect(await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Adult")).status)).toBe(403);
  expect(await page.evaluate(async () => (await fetch("/api/recommendation-events?category=Adult")).status)).toBe(403);
  expect(await page.evaluate(async () => (await fetch("/api/media/people?id=stashdb-stash-scene-1")).status)).toBe(403);
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
  expect(adult.items.some((item: { id: string; artworkUrl?: string }) => item.id.startsWith("stashdb-") && item.artworkUrl === "https://images.example.test/stash.jpg")).toBe(true);
  expect(adult.items.some((item: { id: string; artworkUrl?: string }) => item.id.startsWith("theporndb-") && item.artworkUrl === "https://images.example.test/poster.jpg")).toBe(true);
  const people = await page.evaluate(async () => Promise.all(["tmdb-tv-201", "stashdb-stash-scene-1", "theporndb-scene-adult-scene-1"].map(async id => (await (await fetch(`/api/media/people?id=${id}`)).json()).people)));
  expect(people.map((group: Array<{ name: string }>) => group[0]?.name)).toEqual(["Mock Actor", "Mock Stash Performer", "Mock Adult Performer"]);
  expect(adult.cursor).toBeTruthy();
  const next = await page.evaluate(async cursor => (await fetch(`/api/discovery-feed?category=Adult&cursor=${encodeURIComponent(cursor)}`)).json(), adult.cursor);
  expect(next.items.some((item: { id: string }) => item.id === "theporndb-scene-adult-scene-26")).toBe(true);
  expect(next.items.some((item: { id: string }) => item.id === "stashdb-stash-scene-26")).toBe(true);
  const sources = await (await request.get("http://127.0.0.1:4199/__control")).json();
  expect(sources.requests.some((entry: { input?: { input?: { tags?: { modifier: string; value: string[] } } } }) => entry.input?.input?.tags?.modifier === "INCLUDES" && entry.input.input.tags.value.includes("tag-drama"))).toBe(true);
  await page.route("https://images.example.test/**", route => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ8AAAAASUVORK5CYII=", "base64") }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Media categories" }).getByRole("button", { name: "Adult" }).click();
  await page.getByRole("button", { name: "I’m 18 or older" }).click();
  await expect(page.locator(".card-active h2")).toBeVisible();
  await page.locator(".card-active .card-poster").click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Performers" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Mock Adult Performer")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".person-portrait img")).toHaveAttribute("src", "https://images.example.test/person.jpg");
  await page.getByRole("button", { name: "Close details" }).click();
  await request.post("http://127.0.0.1:4199/__control", { data: { failMovies: true } });
  const shows = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Shows")).json());
  const movies = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(shows.items.length).toBeGreaterThan(0);
  expect(movies.status.outcome).toBe("unavailable");
});

test("related shows and credit lanes preserve provenance and category boundaries", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  const events = [201, 202].map((id, index) => ({ ...learningDecision(`tmdb-tv-${id}`, index), id: `show-seed-${index}`, category: "Shows", decision: "seen", rating: 9 }));
  const seeded = await page.evaluate(async events => (await fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) })).json(), events);
  expect(seeded.acceptedIds).toHaveLength(2);
  const feed = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Shows")).json());
  expect(feed.batches.filter((batch: { lane: string }) => batch.lane === "related")).toHaveLength(2);
  expect(feed.batches.some((batch: { lane: string }) => batch.lane === "person")).toBe(true);
  expect(feed.batches.some((batch: { lane: string }) => batch.lane === "company")).toBe(true);
  expect(feed.items.some((item: { id: string }) => item.id === "tmdb-tv-9901")).toBe(true);
  expect(feed.items.some((item: { id: string }) => ["tmdb-tv-9902", "tmdb-tv-9903"].includes(item.id))).toBe(false);
  expect(feed.creditCoverage.resolved).toBeGreaterThan(0);
  expect(JSON.stringify(feed.candidateFeatures)).toContain("actor:77");
  const next = await page.evaluate(async cursor => (await fetch(`/api/discovery-feed?category=Shows&cursor=${encodeURIComponent(cursor)}`)).json(), feed.cursor);
  expect(next.batches.filter((batch: { lane: string; provenance?: { page: number } }) => batch.lane === "related" && batch.provenance?.page === 2)).toHaveLength(2);
  expect(next.items.some((item: { id: string }) => item.id === "tmdb-tv-9904")).toBe(true);
  await page.goto("/");
  await expect.poll(async () => page.evaluate(async () => {
    const history = (await (await fetch("/api/account/export")).json()).recommendationHistory;
    return history.filter((row: { lane: string; provenance?: { endpoint: string } }) => row.lane === "related" && row.provenance?.endpoint === "recommendations").length;
  })).toBe(2);
  const rejected = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Adult")).status);
  expect(rejected).toBe(403);
});

test("a high show rating refreshes related discovery without moving the locked card", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Media categories" }).getByRole("button", { name: "Shows" }).click();
  await expect(page.locator(".card-active h2")).toHaveText("Mock Show One");
  await page.getByRole("button", { name: "Seen it: rate Mock Show One" }).click();
  await page.getByRole("button", { name: "9 out of 10", exact: true }).click();
  await expect(page.locator(".card-active h2")).toHaveText("Mock Show Two");
  await expect.poll(async () => page.evaluate(async () => {
    const events = (await (await fetch("/api/account/export")).json()).recommendationHistory;
    return events.some((event: { lane: string; eventType: string }) => event.lane === "related" && event.eventType === "candidate_batch");
  }), { timeout: 30_000 }).toBe(true);
  await expect(page.locator(".card-active h2")).toHaveText("Mock Show Two");
  await page.getByRole("button", { name: "Seen it: rate Mock Show Two" }).click();
  await page.getByRole("button", { name: "9 out of 10", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const events = (await (await fetch("/api/account/export")).json()).recommendationHistory;
    return events.some((event: { lane: string }) => event.lane === "person") && events.some((event: { lane: string }) => event.lane === "company");
  }), { timeout: 30_000 }).toBe(true);
  const events = await page.evaluate(async () => (await (await fetch("/api/account/export")).json()).recommendationHistory);
  expect(events.some((event: { eventType: string; algorithmVersion: string }) => event.eventType === "retrieval_snapshot" && event.algorithmVersion === "content-v7")).toBe(true);
});

test("credit hydration skips considered titles and missing credits stay neutral", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await request.post("http://127.0.0.1:4199/__control", { data: { extended: true, missingCredits: true } });
  const events = [learningDecision("tmdb-movie-101", 0), learningDecision("tmdb-movie-102", 1)];
  await page.evaluate(async rows => fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: rows }) }), events);
  const feed = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(feed.snapshot.candidateRequestedIds).not.toContain("tmdb-movie-101");
  expect(feed.snapshot.candidateRequestedIds).not.toContain("tmdb-movie-102");
  expect(feed.snapshot.candidateRequestedIds).toHaveLength(10);
  expect(feed.snapshot.candidateResolvedIds).toHaveLength(0);
  expect(feed.creditCoverage.resolved).toBe(0);
});

test("a provider 429 preserves the cursor and retries after its cooldown", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await request.post("http://127.0.0.1:4199/__control", { data: { throttleMovies: true } });
  const first = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Movies")).json());
  expect(first.sources.some((source: { retryAt: number | null }) => source.retryAt !== null)).toBe(true);
  await request.post("http://127.0.0.1:4199/__control", { data: { throttleMovies: false } });
  await expect.poll(async () => page.evaluate(async cursor => {
    const feed = await (await fetch(`/api/discovery-feed?category=Movies&cursor=${encodeURIComponent(cursor)}`)).json();
    return feed.items.length;
  }, first.cursor), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("a failed related lane does not prevent popular pagination", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await request.post("http://127.0.0.1:4199/__control", { data: { extended: true, failRelated: true } });
  const seed = { ...learningDecision("tmdb-tv-201", 0), id: "related-seed", category: "Shows", decision: "seen", rating: 9 };
  await page.evaluate(async event => fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [event] }) }), seed);
  const first = await page.evaluate(async () => (await fetch("/api/discovery-feed?category=Shows")).json());
  expect(first.sources).toContainEqual(expect.objectContaining({ lane: "related", outcome: "unavailable" }));
  expect(first.items.length).toBeGreaterThan(0);
  const next = await page.evaluate(async cursor => (await fetch(`/api/discovery-feed?category=Shows&cursor=${encodeURIComponent(cursor)}`)).json(), first.cursor);
  expect(next.sources).toContainEqual(expect.objectContaining({ lane: "popular", outcome: "ready" }));
  expect(next.items.some((item: { id: string }) => item.id === "tmdb-tv-121")).toBe(true);
});

test("dialogs hold keyboard focus, and saves and removals can be undone on a phone-sized screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const shortlistCount = page.locator(".panel-heading h2 span");
  await setupRecommendationAdmin(page);
  await page.goto("/");
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie One");
  await expect(page.getByText(/Drag the card, or use/)).toBeVisible();
  expect(await page.locator(".decision-row").evaluate(row => row.getBoundingClientRect().bottom <= window.innerHeight), "Pass and Keep fit above the fold").toBe(true);

  const details = page.getByRole("button", { name: "Details for Mock Movie One" });
  await details.click();
  const dialog = page.getByRole("dialog", { name: "Mock Movie One" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(details).toBeFocused();

  await page.getByRole("button", { name: "Want to see", exact: true }).click();
  await expect(page.getByText(/Drag the card, or use/)).toHaveCount(0);
  await expect(shortlistCount).toHaveText("1");
  await page.getByRole("button", { name: "Remove Mock Movie One from shortlist" }).click();
  await expect(shortlistCount).toHaveText("0");
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(shortlistCount).toHaveText("1");

  await page.getByRole("button", { name: "Review & compare" }).click();
  await page.getByRole("button", { name: "Save 1 title" }).click();
  await expect(page.getByRole("dialog", { name: "Saved for later" })).toBeVisible();
  const undoSave = page.getByRole("dialog").getByRole("button", { name: "Undo" });
  for (let index = 0; index < 6 && !(await undoSave.evaluate(button => button === document.activeElement)); index++) await page.keyboard.press("Tab");
  await expect(undoSave).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Saved for later" })).toHaveCount(0);
  await expect(shortlistCount).toHaveText("1");

  await page.getByRole("button", { name: "Review & compare" }).click();
  await page.getByRole("button", { name: "Save 1 title" }).click();
  await page.getByRole("button", { name: "Remove Mock Movie One from saved" }).click();
  await expect(page.getByText("Your saved list is empty.", { exact: false })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const history = (await (await fetch("/api/account/export")).json()).recommendationHistory as Array<{ eventType: string }>;
    return history.filter(event => event.eventType === "save_withdrawn").length;
  })).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("arrow keys decide from the first card, and rating keys move focus without committing", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await page.goto("/");
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie One");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie Two");
  await expect(page.locator(".panel-heading h2 span")).toHaveText("1");
  await page.getByRole("button", { name: "Seen it: rate Mock Movie Two" }).click();
  await expect(page.getByRole("button", { name: "1 out of 10", exact: true })).toBeFocused();
  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "5 out of 10", exact: true })).toBeFocused();
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie Two");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mock Movie Two" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async () => {
    const history = (await (await fetch("/api/account/export")).json()).recommendationHistory as Array<{ eventType: string; itemId: string; rating: number | null }>;
    return history.find(event => event.eventType === "decision" && event.itemId === "tmdb-movie-102")?.rating ?? null;
  })).toBe(5);
});

test("review removals survive leaving review, and swipes are announced to screen readers", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await page.goto("/");
  const announcer = page.locator("p.sr-only[aria-live=polite]");
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
  await expect(announcer).toHaveText("Shortlisted Mock Movie One");
  await page.getByRole("button", { name: "Want to see", exact: true }).click();
  await expect(announcer).toHaveText("Shortlisted Mock Movie Two");
  await page.getByRole("button", { name: "Review & compare" }).click();
  await page.getByRole("button", { name: "Remove from shortlist" }).first().click();
  await expect(page.getByText("Removed for now", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to exploring" }).click();
  await page.getByRole("button", { name: "Review & compare" }).click();
  await expect(page.getByText("Removed for now", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
});

test("the header stays available while the session loads", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await page.route("**/api/discovery-state", async route => {
    if (route.request().method() === "GET") await new Promise(resolve => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("Picking up where you left off…")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Media categories" })).toBeVisible();
  await expect(page.locator("summary.avatar")).toBeVisible();
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie One", { timeout: 15_000 });
});

test("event writes reject other accounts' IDs and Adult without access, and are rate limited", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  const post = (target: import("@playwright/test").Page, events: unknown[]) => target.evaluate(async rows => {
    const response = await fetch("/api/recommendation-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: rows }) });
    return { status: response.status, body: await response.json() };
  }, events);
  const shared = { ...learningDecision("tmdb-movie-900", 0), id: "shared-event-id" };
  expect((await post(page, [shared])).body.acceptedIds).toEqual(["shared-event-id"]);
  const adult = { ...learningDecision("stashdb-stash-scene-1", 1, "keep", "Adult"), id: "adult-event" };
  expect((await post(page, [adult])).body.rejected).toMatchObject([{ id: "adult-event", code: "adult_disabled" }]);

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto("/sign-up");
  await member.locator('input[name="name"]').fill("Event Member");
  await member.locator('input[name="inviteCode"]').fill("playwright-invite");
  await member.locator('input[name="email"]').fill("event-member@example.test");
  await member.locator('input[name="password"]').fill(password);
  await member.locator('input[name="confirmPassword"]').fill(password);
  await member.getByRole("button", { name: "Create account" }).click();
  await expect(member).toHaveURL(/\/$/, { timeout: 30_000 });
  const foreign = await post(member, [shared]);
  expect(foreign.body.acceptedIds).toEqual([]);
  expect(foreign.body.rejected).toMatchObject([{ id: "shared-event-id", code: "duplicate" }]);
  await memberContext.close();

  const statuses: number[] = [];
  for (let index = 0; index < 25; index++) statuses.push((await post(page, [])).status);
  expect(statuses).toContain(429);
});

test("Seen it: press and slide rates in one gesture, a number key rates the focused card, and a press outside closes the row", async ({ page }) => {
  test.setTimeout(90_000);
  await setupRecommendationAdmin(page);
  await page.goto("/");
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie One");

  await page.getByRole("button", { name: /Seen it: rate Mock Movie One/ }).click();
  await expect(page.getByRole("button", { name: "1 out of 10", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Movies", exact: true }).click();
  await expect(page.getByRole("button", { name: "1 out of 10", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie One");

  const seen = (await page.getByRole("button", { name: /Seen it: rate Mock Movie One/ }).boundingBox())!;
  const row = (await page.locator(".card-active .card-actions").boundingBox())!;
  await page.mouse.move(seen.x + seen.width / 2, seen.y + seen.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + row.width * 0.72, seen.y + seen.height / 2, { steps: 8 });
  await expect(page.locator(".card-active .seen-bubble strong")).toHaveText("8");
  await expect(page.locator(".card-active .seen-bubble small")).toHaveText("Great");
  await page.mouse.up();
  await expect(page.locator(".card-active h2")).toHaveText("Mock Movie Two");

  await page.locator(".card-active").focus();
  await page.keyboard.press("7");
  await expect(page.getByRole("heading", { name: "Mock Movie Two" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async () => {
    const history = (await (await fetch("/api/account/export")).json()).recommendationHistory as Array<{ eventType: string; itemId: string; rating: number | null }>;
    return ["tmdb-movie-101", "tmdb-movie-102"].map(id => history.find(event => event.eventType === "decision" && event.itemId === id)?.rating ?? null);
  })).toEqual([8, 7]);
});
