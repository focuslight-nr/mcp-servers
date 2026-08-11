import assert from "node:assert/strict";
import test from "node:test";
import type https from "node:https";
import { StrictTlsGaiaClient } from "./gaia-client.js";

function client(): StrictTlsGaiaClient {
  return new StrictTlsGaiaClient({
    gatewayHost: "192.0.2.10",
    port: 443,
    username: "auditor",
    password: "secret",
  });
}

test("always creates an HTTPS agent with certificate validation enabled", () => {
  const instance = client() as unknown as {
    http: { defaults: { httpsAgent: https.Agent } };
  };
  assert.equal(
    instance.http.defaults.httpsAgent.options.rejectUnauthorized,
    true,
  );
});

test("rejects non-read endpoints before making a network request", async () => {
  await assert.rejects(() => client().call("set-dns", {}), /not permitted/);
});

test("rejects gateway values containing a URL scheme or path", () => {
  assert.throws(
    () =>
      new StrictTlsGaiaClient({
        gatewayHost: "https://192.0.2.10/path",
        port: 443,
        username: "auditor",
        password: "secret",
      }),
    /without a URL scheme or path/,
  );
});
