import assert from "node:assert/strict";
import test from "node:test";
import { assertIntegrationReadOnly, assertTestNetworkTarget } from "../src/lib/outbound-policy";

test("read-only mode blocks writes and permits integration reads", () => {
  const old = process.env.INTEGRATIONS_READ_ONLY;
  try {
    process.env.INTEGRATIONS_READ_ONLY = "1";
    assert.doesNotThrow(() => assertIntegrationReadOnly("GET"));
    assert.throws(() => assertIntegrationReadOnly("POST"));
    assert.throws(() => assertIntegrationReadOnly("DELETE"));
    assert.throws(() => assertIntegrationReadOnly("GET", { action: "change" }));
  } finally { if (old === undefined) delete process.env.INTEGRATIONS_READ_ONLY; else process.env.INTEGRATIONS_READ_ONLY = old; }
});

test("browser-test isolation allows only the explicit local mock", () => {
  const old = process.env.E2E_NETWORK_ISOLATION;
  try {
    process.env.E2E_NETWORK_ISOLATION = "1";
    assert.doesNotThrow(() => assertTestNetworkTarget("http://127.0.0.1:4199/3/tv/1"));
    for (const url of ["https://api.themoviedb.org/3/tv/1", "http://192.168.1.2:32400/", "http://127.0.0.1:32400/", "http://localhost:4199/"]) assert.throws(() => assertTestNetworkTarget(url));
  } finally { if (old === undefined) delete process.env.E2E_NETWORK_ISOLATION; else process.env.E2E_NETWORK_ISOLATION = old; }
});
