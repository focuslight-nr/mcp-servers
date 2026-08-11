import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface TargetFixtures {
  dns?: unknown;
  dhcp?: unknown;
  dateTime?: unknown;
  hardening?: unknown;
  rulebase?: unknown;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function loadTargetFixtures(
  directory: string,
  target: string,
  inputs: ReadonlySet<string>,
): Promise<TargetFixtures> {
  return {
    ...(inputs.has("gaia.dns")
      ? { dns: await readJson(join(directory, `${target}.dns.json`)) }
      : {}),
    ...(inputs.has("gaia.dhcp")
      ? { dhcp: await readJson(join(directory, `${target}.dhcp.json`)) }
      : {}),
    ...(inputs.has("gaia.dateTime")
      ? {
          dateTime: await readJson(join(directory, `${target}.date-time.json`)),
        }
      : {}),
    ...(inputs.has("gaia.hardening")
      ? {
          hardening: await readJson(
            join(directory, `${target}.hardening.json`),
          ),
        }
      : {}),
    ...(inputs.has("management.accessRulebase")
      ? { rulebase: await readJson(join(directory, `${target}.rulebase.json`)) }
      : {}),
  };
}
