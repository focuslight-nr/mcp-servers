import type {
  AccessRule,
  GaiaHardeningObservations,
  GaiaHardeningUser,
  GaiaObservations,
  GaiaSnmpUser,
} from "./types.js";

export interface RawGaiaResponses {
  dns?: unknown;
  dhcp?: unknown;
  dateTime?: unknown;
  hardening?: unknown;
  expectedTimezone?: string;
}

export interface AdapterResult<T> {
  value: T;
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function unwrapMcpResponse(value: unknown): unknown {
  if (typeof value === "string") {
    return parseJsonText(value);
  }
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return value;
  }

  for (const block of value.content) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      return parseJsonText(block.text);
    }
  }
  return value;
}

function findFirstValue(root: unknown, aliases: string[]): unknown {
  const wanted = new Set(aliases.map(normalizeKey));
  const queue: unknown[] = [root];
  let visited = 0;

  while (queue.length > 0 && visited < 10000) {
    const current = queue.shift();
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key))) {
        return value;
      }
      if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }
  return undefined;
}

function collectValues(root: unknown, aliases: string[]): unknown[] {
  const wanted = new Set(aliases.map(normalizeKey));
  const queue: unknown[] = [root];
  const found: unknown[] = [];
  let visited = 0;

  while (queue.length > 0 && visited < 10000) {
    const current = queue.shift();
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key))) {
        found.push(value);
      } else if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }
  return found;
}

function valueStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(valueStrings);
  }
  if (isRecord(value)) {
    for (const key of [
      "name",
      "address",
      "ip-address",
      "ipv4-address",
      "value",
    ]) {
      const match = Object.entries(value).find(
        ([candidate]) => normalizeKey(candidate) === normalizeKey(key),
      );
      if (match) {
        return valueStrings(match[1]);
      }
    }
  }
  return [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    ["true", "on", "enabled", "enable", "active", "up", "yes", "1"].includes(
      normalized,
    )
  ) {
    return true;
  }
  if (
    [
      "false",
      "off",
      "disabled",
      "disable",
      "inactive",
      "down",
      "no",
      "0",
    ].includes(normalized)
  ) {
    return false;
  }
  return undefined;
}

function directValue(root: unknown, alias: string): unknown {
  if (!isRecord(root)) return undefined;
  const wanted = normalizeKey(alias);
  return Object.entries(root).find(
    ([key]) => normalizeKey(key) === wanted,
  )?.[1];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function objectList(root: unknown, alias = "objects"): unknown[] | undefined {
  const value = directValue(root, alias);
  return Array.isArray(value) ? value : undefined;
}

function hardeningSection(
  root: unknown,
  name: string,
  warnings: string[],
): unknown {
  const section = directValue(root, name);
  if (!isRecord(section)) return undefined;
  if (section.ok === false) {
    warnings.push(
      `Gaia hardening read ${name} failed: ${stringValue(section.error) ?? "unknown error"}`,
    );
    return undefined;
  }
  return section.ok === true ? section.value : section;
}

function mapHardeningUser(value: unknown): GaiaHardeningUser | undefined {
  if (!isRecord(value)) return undefined;
  const name = stringValue(directValue(value, "name"));
  if (!name) return undefined;
  const roles = directValue(value, "roles");
  return {
    name,
    shell: stringValue(directValue(value, "shell")),
    roles: Array.isArray(roles) ? roles.flatMap(valueStrings) : undefined,
    locked: parseBoolean(directValue(value, "locked")),
    requiresTwoFactorAuthentication: parseBoolean(
      directValue(value, "requires-two-factor-authentication"),
    ),
  };
}

function mapSnmpUser(value: unknown): GaiaSnmpUser | undefined {
  if (!isRecord(value)) return undefined;
  const name = stringValue(directValue(value, "name"));
  if (!name) return undefined;
  return {
    name,
    permission: stringValue(directValue(value, "permission")),
    authenticationProtocol: stringValue(
      findFirstValue(directValue(value, "authentication"), ["protocol"]),
    ),
    privacyProtocol: stringValue(
      findFirstValue(directValue(value, "privacy"), ["protocol"]),
    ),
    dataPrivacy: parseBoolean(directValue(value, "data-privacy")),
  };
}

function adaptHardeningResponses(
  raw: unknown,
  warnings: string[],
): GaiaHardeningObservations | undefined {
  if (raw === undefined) return undefined;
  const root = unwrapMcpResponse(raw);
  const version = hardeningSection(root, "version", warnings);
  const users = hardeningSection(root, "users", warnings);
  hardeningSection(root, "roles", warnings);
  const password = hardeningSection(root, "password_policy", warnings);
  const allowed = hardeningSection(root, "allowed_clients", warnings);
  const snmp = hardeningSection(root, "snmp", warnings);
  const snmpUsers = hardeningSection(root, "snmp_users", warnings);
  const syslog = hardeningSection(root, "syslog", warnings);
  const remoteSyslogs = hardeningSection(root, "remote_syslogs", warnings);
  const bgp = hardeningSection(root, "bgp", warnings);

  const lockSettings = directValue(password, "lock-settings");
  const inactivity = directValue(lockSettings, "inactivity-settings");
  const failed = directValue(lockSettings, "failed-attempts-settings");
  const history = directValue(password, "password-history");
  const strength = directValue(password, "password-strength");
  const allowedHosts = unique(
    valueStrings(directValue(allowed, "allowed-hosts")),
  );
  const allowedNetworks = unique(
    valueStrings(directValue(allowed, "allowed-networks")),
  );
  const remoteServers = (objectList(remoteSyslogs) ?? [])
    .filter(isRecord)
    .map((item) => ({
      server: stringValue(directValue(item, "server-ip")),
      protocol: stringValue(directValue(item, "protocol")),
      port: numberValue(directValue(item, "port")),
    }));
  const autonomousSystem =
    stringValue(directValue(bgp, "as")) ?? numberValue(directValue(bgp, "as"));

  return {
    productVersion: stringValue(directValue(version, "product-version")),
    osBuild: stringValue(directValue(version, "os-build")),
    osKernelVersion: stringValue(directValue(version, "os-kernel-version")),
    users: objectList(users)?.map(mapHardeningUser).filter(Boolean) as
      | GaiaHardeningUser[]
      | undefined,
    passwordPolicy:
      password === undefined
        ? undefined
        : {
            minimumLength: numberValue(directValue(strength, "minimum-length")),
            complexity: numberValue(directValue(strength, "complexity")),
            palindromeCheckEnabled: parseBoolean(
              directValue(strength, "palindrome-check-enabled"),
            ),
            historyCheckEnabled: parseBoolean(
              directValue(history, "check-history-enabled"),
            ),
            passwordExpirationDays:
              numberValue(
                directValue(lockSettings, "password-expiration-days"),
              ) ??
              stringValue(
                directValue(lockSettings, "password-expiration-days"),
              ),
            expirationLockoutDays:
              numberValue(
                directValue(
                  lockSettings,
                  "password-expiration-maximum-days-before-lock",
                ),
              ) ??
              stringValue(
                directValue(
                  lockSettings,
                  "password-expiration-maximum-days-before-lock",
                ),
              ),
            lockUnusedAccountsEnabled: parseBoolean(
              directValue(inactivity, "lock-unused-accounts-enabled"),
            ),
            inactivityThresholdDays: numberValue(
              directValue(inactivity, "inactivity-threshold-days"),
            ),
            failedLockEnabled: parseBoolean(
              directValue(failed, "failed-lock-enabled"),
            ),
            failedLockEnforcedOnAdmin: parseBoolean(
              directValue(failed, "failed-lock-enforced-on-admin"),
            ),
            failedAttemptsAllowed: numberValue(
              directValue(failed, "failed-attempts-allowed"),
            ),
            failedLockDurationSeconds: numberValue(
              directValue(failed, "failed-lock-duration-seconds"),
            ),
            allUsersRequireTwoFactorAuthentication: parseBoolean(
              directValue(
                password,
                "all-users-require-two-factor-authentication",
              ),
            ),
          },
    allowedClients:
      allowed === undefined
        ? undefined
        : {
            anyHost: parseBoolean(directValue(allowed, "allowed-any-host")),
            hosts: allowedHosts,
            networks: allowedNetworks,
            configured: unique([...allowedHosts, ...allowedNetworks]),
          },
    snmp:
      snmp === undefined
        ? undefined
        : {
            enabled: parseBoolean(directValue(snmp, "enabled")),
            version: stringValue(directValue(snmp, "version")),
            interfaces: unique(valueStrings(directValue(snmp, "interfaces"))),
            users: (objectList(snmpUsers) ?? [])
              .map(mapSnmpUser)
              .filter(Boolean) as GaiaSnmpUser[],
          },
    syslog:
      syslog === undefined && remoteSyslogs === undefined
        ? undefined
        : {
            sendToManagement: parseBoolean(directValue(syslog, "send-to-mgmt")),
            remoteServers,
          },
    bgp:
      bgp === undefined
        ? undefined
        : {
            configured: autonomousSystem !== undefined,
            autonomousSystem,
          },
  };
}

export function adaptGaiaResponses(
  raw: RawGaiaResponses,
): AdapterResult<GaiaObservations> {
  const warnings: string[] = [];
  const dns = unwrapMcpResponse(raw.dns);
  const dhcp = unwrapMcpResponse(raw.dhcp);
  const dateTime = unwrapMcpResponse(raw.dateTime);
  const hardening = adaptHardeningResponses(raw.hardening, warnings);

  const dnsValues = collectValues(dns, [
    "dns-servers",
    "dns-server",
    "name-servers",
    "name-server",
    "servers",
    "primary-dns-server",
    "secondary-dns-server",
    "tertiary-dns-server",
    "primary",
    "secondary",
    "tertiary",
  ]);
  const dnsServers =
    raw.dns === undefined ? undefined : unique(dnsValues.flatMap(valueStrings));
  if (raw.dns !== undefined && dnsServers?.length === 0) {
    warnings.push(
      "DNS response was supplied, but no DNS server fields were recognized.",
    );
  }

  const dhcpEnabled =
    raw.dhcp === undefined
      ? undefined
      : parseBoolean(
          findFirstValue(dhcp, [
            "dhcp-enabled",
            "dhcp-server-enabled",
            "enabled",
            "status",
            "state",
          ]),
        );
  if (raw.dhcp !== undefined && dhcpEnabled === undefined) {
    warnings.push(
      "DHCP response was supplied, but its enabled state was not recognized.",
    );
  }

  const ntpSection =
    findFirstValue(dateTime, ["ntp-configuration", "ntp"]) ?? dateTime;
  const ntpEnabled =
    raw.dateTime === undefined
      ? undefined
      : parseBoolean(
          findFirstValue(ntpSection, [
            "ntp-enabled",
            "enabled",
            "status",
            "state",
          ]),
        );
  const ntpValues = collectValues(ntpSection, [
    "ntp-servers",
    "ntp-server",
    "servers",
    "primary-ntp-server",
    "secondary-ntp-server",
    "primary",
    "secondary",
  ]);
  const ntpServers =
    raw.dateTime === undefined
      ? undefined
      : unique(ntpValues.flatMap(valueStrings));
  const timezoneValue = findFirstValue(
    findFirstValue(dateTime, ["current-time-date", "time-and-date"]) ??
      dateTime,
    ["timezone", "time-zone"],
  );
  const timezone = valueStrings(timezoneValue)[0];

  if (raw.dateTime !== undefined && ntpEnabled === undefined) {
    warnings.push(
      "Date/time response was supplied, but the NTP enabled state was not recognized.",
    );
  }
  if (raw.dateTime !== undefined && ntpServers?.length === 0) {
    warnings.push(
      "Date/time response was supplied, but no NTP server fields were recognized.",
    );
  }
  if (raw.dateTime !== undefined && !timezone) {
    warnings.push(
      "Date/time response was supplied, but no configured timezone field was recognized.",
    );
  }

  return {
    value: {
      dnsServers,
      dhcpEnabled,
      ntpEnabled,
      ntpServers,
      timezone,
      expectedTimezone: raw.expectedTimezone,
      hardening,
    },
    warnings,
  };
}

function objectName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = findFirstValue(value, ["name"]);
  return typeof candidate === "string" ? candidate : undefined;
}

function objectNames(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  return unique(
    values.flatMap((item) => {
      const name = objectName(item);
      return name ? [name] : valueStrings(item);
    }),
  );
}

function mapRule(value: unknown): AccessRule | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = typeof value.type === "string" ? value.type : undefined;
  if (type && !["access-rule", "rule"].includes(type)) {
    return undefined;
  }
  const source = value.source ?? value.sources;
  const destination = value.destination ?? value.destinations;
  const service = value.service ?? value.services;
  const ruleNumber = value["rule-number"] ?? value.ruleNumber ?? value.number;
  const enabled = parseBoolean(value.enabled);

  return {
    ruleNumber:
      typeof ruleNumber === "string" || typeof ruleNumber === "number"
        ? ruleNumber
        : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    source: objectNames(source),
    destination: objectNames(destination),
    service: objectNames(service),
    action: objectName(value.action),
    track: objectName(value.track),
    enabled: enabled ?? true,
    type: "rule",
  };
}

function flattenRuleItems(items: unknown[]): AccessRule[] {
  const rules: AccessRule[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const type = typeof item.type === "string" ? item.type : undefined;
    if (type === "access-section" || type === "section") {
      const nested = item.rulebase ?? item.rules;
      if (Array.isArray(nested)) {
        rules.push(...flattenRuleItems(nested));
      }
      continue;
    }
    const mapped = mapRule(item);
    if (mapped) {
      rules.push(mapped);
    }
  }
  return rules;
}

function pageRuleItems(page: unknown): unknown[] {
  if (Array.isArray(page)) {
    return page;
  }
  const rulebase = findFirstValue(page, ["rulebase"]);
  if (Array.isArray(rulebase)) {
    return rulebase;
  }
  const sections = findFirstValue(page, ["sections"]);
  if (Array.isArray(sections)) {
    return sections;
  }
  return [];
}

export function adaptAccessRulebasePages(
  rawPages: unknown[],
): AdapterResult<AccessRule[]> {
  const warnings: string[] = [];
  const rules: AccessRule[] = [];

  rawPages.forEach((rawPage, index) => {
    const page = unwrapMcpResponse(rawPage);
    const items = pageRuleItems(page);
    if (items.length === 0) {
      warnings.push(
        `Access Rulebase page ${index + 1} contained no recognized rulebase array.`,
      );
      return;
    }
    rules.push(...flattenRuleItems(items));

    const total = Number(findFirstValue(page, ["total"]));
    const to = Number(findFirstValue(page, ["to"]));
    if (
      Number.isFinite(total) &&
      Number.isFinite(to) &&
      to < total &&
      index === rawPages.length - 1
    ) {
      warnings.push(
        `Access Rulebase appears incomplete: received through ${to} of ${total}.`,
      );
    }
  });

  if (rawPages.length > 0 && rules.length === 0) {
    warnings.push(
      "No access rules could be normalized from the supplied Management responses.",
    );
  }
  return { value: rules, warnings };
}
