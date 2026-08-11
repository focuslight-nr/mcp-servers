import type { GaiaCredentialProvider } from "./credentials.js";
import { StrictTlsGaiaClient } from "./gaia-client.js";
import type { GaiaClientConnection, GaiaSessionClient } from "./gaia-client.js";

export interface GaiaToolTarget {
  gatewayIp: string;
  port: number;
  credentialProfile?: string;
  memberId?: string;
  virtualSystemId?: number;
}

export type GaiaClientFactory = (
  connection: GaiaClientConnection,
) => GaiaSessionClient;

export class GaiaReadOnlyService {
  private readonly clients = new Map<string, GaiaSessionClient>();

  constructor(
    private readonly credentials: GaiaCredentialProvider,
    private readonly clientFactory: GaiaClientFactory = (connection) =>
      new StrictTlsGaiaClient(connection),
  ) {}

  private client(target: GaiaToolTarget): GaiaSessionClient {
    this.credentials.assertTargetAllowed(target.gatewayIp);
    const key = `${target.gatewayIp.toLowerCase()}:${target.port}:${target.credentialProfile ?? "default"}`;
    const existing = this.clients.get(key);
    if (existing) return existing;

    const credentials = this.credentials.getCredentials(
      target.credentialProfile,
    );
    const created = this.clientFactory({
      gatewayHost: target.gatewayIp,
      port: target.port,
      ...credentials,
    });
    this.clients.set(key, created);
    return created;
  }

  private commonParams(target: GaiaToolTarget): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (target.memberId) params["member-id"] = target.memberId;
    if (target.virtualSystemId !== undefined)
      params["virtual-system-id"] = target.virtualSystemId;
    return params;
  }

  async showDns(target: GaiaToolTarget): Promise<unknown> {
    return this.client(target).call("show-dns", this.commonParams(target));
  }

  async showDhcp(target: GaiaToolTarget): Promise<unknown> {
    return this.client(target).call(
      "show-dhcp-server",
      this.commonParams(target),
    );
  }

  async showDateTime(target: GaiaToolTarget): Promise<unknown> {
    const client = this.client(target);
    const params = this.commonParams(target);
    const ntp = await client.call("show-ntp", params);
    const currentTimeDate = await client.call("show-time-and-date", params);
    const availableTimezones = await client.call("show-timezones", params);
    return {
      ntp_configuration: ntp,
      current_time_date: currentTimeDate,
      available_timezones: availableTimezones,
    };
  }

  async showHardeningState(target: GaiaToolTarget): Promise<unknown> {
    const client = this.client(target);
    const params = this.commonParams(target);
    const reads = {
      version: "show-version",
      users: "show-users",
      roles: "show-roles",
      password_policy: "show-password-policy",
      allowed_clients: "show-allowed-clients",
      snmp: "show-snmp",
      snmp_users: "show-snmp-users",
      syslog: "show-syslog",
      remote_syslogs: "show-remote-syslogs",
      bgp: "show-configuration-bgp",
    } as const;
    const result: Record<
      string,
      { ok: boolean; value?: unknown; error?: string }
    > = {};
    // Sequential reads reuse one authenticated session and avoid login races.
    for (const [key, endpoint] of Object.entries(reads)) {
      try {
        result[key] = { ok: true, value: await client.call(endpoint, params) };
      } catch (error) {
        result[key] = { ok: false, error: (error as Error).message };
      }
    }
    if (Object.values(result).every((item) => !item.ok)) {
      throw new Error(
        `Every Gaia hardening read failed: ${Object.values(result)
          .map((item) => item.error)
          .filter(Boolean)
          .join("; ")}`,
      );
    }
    return result;
  }
}
