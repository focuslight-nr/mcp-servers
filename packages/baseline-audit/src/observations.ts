import type {
  AccessRule,
  GaiaObservations,
  ObservationDocument,
} from "./types.js";

interface NormalizedRule extends AccessRule {
  label: string;
}

function ruleLabel(rule: AccessRule, index: number): string {
  const number = rule.ruleNumber ?? index + 1;
  return rule.name ? `${number} (${rule.name})` : String(number);
}

export function buildObservationDocument(input: {
  gaia?: GaiaObservations;
  rules?: AccessRule[];
  parameters?: Record<string, unknown>;
}): ObservationDocument {
  const observations: ObservationDocument = {};
  if (input.gaia) {
    observations.gaia = {
      dnsServers: input.gaia.dnsServers,
      dhcpEnabled: input.gaia.dhcpEnabled,
      ntpEnabled: input.gaia.ntpEnabled,
      ntpServers: input.gaia.ntpServers,
      timezone: input.gaia.timezone,
    };
  }
  if (input.rules) {
    const activeRules: NormalizedRule[] = input.rules
      .map((rule, index) => ({ ...rule, label: ruleLabel(rule, index) }))
      .filter((rule) => rule.type !== "section" && rule.enabled !== false);
    observations.firewall = {
      activeRules,
      ...(activeRules.length > 0
        ? { lastActiveRule: activeRules[activeRules.length - 1] }
        : {}),
    };
  }
  observations.parameters = {
    ...(input.gaia?.expectedTimezone
      ? { expectedTimezone: input.gaia.expectedTimezone }
      : {}),
    ...(input.parameters ?? {}),
  };
  return observations;
}
