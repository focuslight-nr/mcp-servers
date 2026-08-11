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
