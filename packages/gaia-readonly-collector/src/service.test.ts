import assert from "node:assert/strict";
import test from "node:test";
import type { GaiaCredentialProvider } from "./credentials.js";
import type { GaiaSessionClient } from "./gaia-client.js";
import { GaiaReadOnlyService } from "./service.js";

class FakeCredentialProvider implements GaiaCredentialProvider {
  allowedChecks: string[] = [];
  profiles: Array<string | undefined> = [];

  assertTargetAllowed(target: string): void {
    this.allowedChecks.push(target);
  }

  getCredentials(profile?: string) {
    this.profiles.push(profile);
    return { username: "auditor", password: "secret" };
  }
}

class FakeClient implements GaiaSessionClient {
  calls: Array<{ endpoint: string; data: Record<string, unknown> }> = [];

  async call(
    endpoint: string,
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    this.calls.push({ endpoint, data });
    return { endpoint };
  }
}

test("exposes only the required read operations and reuses a target session", async () => {
  const credentials = new FakeCredentialProvider();
  const client = new FakeClient();
  let clientsCreated = 0;
  const service = new GaiaReadOnlyService(credentials, () => {
    clientsCreated += 1;
    return client;
  });
  const target = {
    gatewayIp: "192.0.2.10",
    port: 443,
    credentialProfile: "tokyo",
    memberId: "1",
  };

  await service.showDns(target);
  await service.showDhcp(target);
  const dateTime = await service.showDateTime(target);

  assert.equal(clientsCreated, 1);
  assert.deepEqual(credentials.profiles, ["tokyo"]);
  assert.equal(credentials.allowedChecks.length, 3);
  assert.deepEqual(
    client.calls.map((item) => item.endpoint),
    [
      "show-dns",
      "show-dhcp-server",
      "show-ntp",
      "show-time-and-date",
      "show-timezones",
    ],
  );
  assert.deepEqual(client.calls[0].data, { "member-id": "1" });
  assert.deepEqual(dateTime, {
    ntp_configuration: { endpoint: "show-ntp" },
    current_time_date: { endpoint: "show-time-and-date" },
    available_timezones: { endpoint: "show-timezones" },
  });
});

test("collects the fixed hardening reads and preserves partial API support", async () => {
  const credentials = new FakeCredentialProvider();
  const client = new FakeClient();
  client.call = async (endpoint, data = {}) => {
    client.calls.push({ endpoint, data });
    if (endpoint === "show-roles") throw new Error("not supported");
    return { endpoint };
  };
  const service = new GaiaReadOnlyService(credentials, () => client);

  const result = (await service.showHardeningState({
    gatewayIp: "192.0.2.10",
    port: 443,
  })) as Record<string, { ok: boolean; value?: unknown; error?: string }>;

  assert.equal(result.version.ok, true);
  assert.equal(result.roles.ok, false);
  assert.match(result.roles.error ?? "", /not supported/);
  assert.deepEqual(
    client.calls.map((item) => item.endpoint),
    [
      "show-version",
      "show-users",
      "show-roles",
      "show-password-policy",
      "show-allowed-clients",
      "show-snmp",
      "show-snmp-users",
      "show-syslog",
      "show-remote-syslogs",
      "show-configuration-bgp",
    ],
  );
});
