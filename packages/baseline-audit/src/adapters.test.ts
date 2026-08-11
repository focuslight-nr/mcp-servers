import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptAccessRulebasePages,
  adaptGaiaResponses,
  unwrapMcpResponse,
} from "./adapters.js";

test("unwraps JSON from an MCP text response", () => {
  const value = unwrapMcpResponse({
    content: [{ type: "text", text: '{"enabled":"on"}' }],
  });
  assert.deepEqual(value, { enabled: "on" });
});

test("normalizes representative Gaia MCP responses", () => {
  const adapted = adaptGaiaResponses({
    dns: {
      "dns-servers": [{ address: "192.0.2.53" }, { address: "198.51.100.53" }],
    },
    dhcp: { enabled: "off" },
    dateTime: {
      ntp_configuration: {
        enabled: true,
        servers: [{ address: "192.0.2.123" }, { address: "198.51.100.123" }],
      },
      current_time_date: { timezone: "Asia/Tokyo" },
    },
    expectedTimezone: "Asia/Tokyo",
  });

  assert.deepEqual(adapted.value.dnsServers, ["192.0.2.53", "198.51.100.53"]);
  assert.equal(adapted.value.dhcpEnabled, false);
  assert.equal(adapted.value.ntpEnabled, true);
  assert.deepEqual(adapted.value.ntpServers, ["192.0.2.123", "198.51.100.123"]);
  assert.equal(adapted.value.timezone, "Asia/Tokyo");
  assert.deepEqual(adapted.warnings, []);
});

test("normalizes the official Gaia hardening show responses", () => {
  const adapted = adaptGaiaResponses({
    hardening: {
      version: {
        ok: true,
        value: {
          "product-version": "R82",
          "os-build": "123",
          "os-kernel-version": "4.18.0-test",
        },
      },
      users: {
        ok: true,
        value: {
          objects: [
            {
              name: "admin",
              shell: "cli",
              roles: ["adminRole"],
              locked: false,
              "requires-two-factor-authentication": true,
            },
          ],
        },
      },
      roles: { ok: false, error: "not supported on this release" },
      password_policy: {
        ok: true,
        value: {
          "password-strength": {
            "minimum-length": 10,
            complexity: 4,
            "palindrome-check-enabled": true,
          },
          "password-history": { "check-history-enabled": true },
          "lock-settings": {
            "password-expiration-days": 90,
            "password-expiration-maximum-days-before-lock": 1,
            "inactivity-settings": {
              "lock-unused-accounts-enabled": true,
              "inactivity-threshold-days": 30,
            },
            "failed-attempts-settings": {
              "failed-lock-enabled": true,
              "failed-lock-enforced-on-admin": true,
              "failed-attempts-allowed": 5,
              "failed-lock-duration-seconds": 7200,
            },
          },
          "all-users-require-two-factor-authentication": true,
        },
      },
      allowed_clients: {
        ok: true,
        value: {
          "allowed-any-host": false,
          "allowed-hosts": ["192.0.2.10"],
          "allowed-networks": ["198.51.100.0/24"],
        },
      },
      snmp: { ok: true, value: { enabled: true, version: "v3-only" } },
      snmp_users: {
        ok: true,
        value: {
          objects: [
            {
              name: "monitor",
              permission: "read-only",
              authentication: { protocol: "SHA512" },
              privacy: { protocol: "AES256" },
              "data-privacy": true,
            },
          ],
        },
      },
      syslog: { ok: true, value: { "send-to-mgmt": true } },
      remote_syslogs: {
        ok: true,
        value: { objects: [{ "server-ip": "192.0.2.20", port: 514 }] },
      },
      bgp: { ok: true, value: { as: 64512 } },
    },
  });

  assert.equal(adapted.value.hardening?.productVersion, "R82");
  assert.equal(adapted.value.hardening?.users?.[0]?.shell, "cli");
  assert.equal(adapted.value.hardening?.passwordPolicy?.minimumLength, 10);
  assert.deepEqual(adapted.value.hardening?.allowedClients?.configured, [
    "192.0.2.10",
    "198.51.100.0/24",
  ]);
  assert.equal(
    adapted.value.hardening?.snmp?.users?.[0]?.authenticationProtocol,
    "SHA512",
  );
  assert.equal(adapted.value.hardening?.syslog?.sendToManagement, true);
  assert.equal(adapted.value.hardening?.bgp?.configured, true);
  assert.match(adapted.warnings[0], /roles failed/);
});

test("normalizes nested Management access sections and reports incomplete pagination", () => {
  const adapted = adaptAccessRulebasePages([
    {
      from: 1,
      to: 2,
      total: 3,
      rulebase: [
        {
          type: "access-section",
          name: "Application",
          rulebase: [
            {
              type: "access-rule",
              "rule-number": 1,
              name: "Web",
              source: [{ name: "Web clients" }],
              destination: [{ name: "Web servers" }],
              service: [{ name: "https" }],
              action: { name: "Accept" },
              track: { name: "Log" },
              enabled: true,
            },
          ],
        },
        {
          type: "access-rule",
          "rule-number": 2,
          name: "Cleanup",
          source: ["Any"],
          destination: ["Any"],
          service: ["Any"],
          action: "Drop",
          track: "Log",
        },
      ],
    },
  ]);

  assert.equal(adapted.value.length, 2);
  assert.deepEqual(adapted.value[0].source, ["Web clients"]);
  assert.equal(adapted.value[1].action, "Drop");
  assert.match(adapted.warnings[0], /incomplete/);
});
