import { readFileSync } from "node:fs";
import https from "node:https";
import axios, { AxiosInstance } from "axios";
import type { GaiaCredentials } from "./credentials.js";

const ALLOWED_ENDPOINTS = new Set([
  "show-dns",
  "show-dhcp-server",
  "show-ntp",
  "show-time-and-date",
  "show-timezones",
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
]);

export interface GaiaSessionClient {
  call(endpoint: string, data?: Record<string, unknown>): Promise<unknown>;
}

export interface GaiaClientConnection extends GaiaCredentials {
  gatewayHost: string;
  port: number;
  requestTimeoutMs?: number;
}

function validateHost(host: string): string {
  const value = host.trim();
  if (!/^[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error(
      "gateway_ip must be an IPv4 address or DNS hostname without a URL scheme or path",
    );
  }
  return value;
}

function sanitizedApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message =
      typeof error.response?.data === "object" && error.response?.data !== null
        ? JSON.stringify(error.response.data, (key, value) =>
            /password|sid|token/i.test(key) ? "[REDACTED]" : value,
          )
        : error.message;
    return new Error(
      `Gaia API request failed${status ? ` (${status})` : ""}: ${message}`,
    );
  }
  return error as Error;
}

export class StrictTlsGaiaClient implements GaiaSessionClient {
  private readonly http: AxiosInstance;
  private sid?: string;

  constructor(private readonly connection: GaiaClientConnection) {
    const host = validateHost(connection.gatewayHost);
    if (
      !Number.isInteger(connection.port) ||
      connection.port < 1 ||
      connection.port > 65535
    ) {
      throw new Error("Gaia port must be between 1 and 65535");
    }
    const ca = connection.caFile ? readFileSync(connection.caFile) : undefined;
    this.http = axios.create({
      baseURL: `https://${host}:${connection.port}/gaia_api`,
      timeout: connection.requestTimeoutMs ?? 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: true,
        ca,
        keepAlive: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
  }

  private async login(): Promise<void> {
    try {
      const response = await this.http.post("/login", {
        user: this.connection.username,
        password: this.connection.password,
      });
      if (!response.data?.sid || typeof response.data.sid !== "string") {
        throw new Error("Gaia login response did not include a session ID");
      }
      this.sid = response.data.sid;
    } catch (error) {
      throw sanitizedApiError(error);
    }
  }

  async call(
    endpoint: string,
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      throw new Error(
        `Gaia endpoint is not permitted by this read-only collector: ${endpoint}`,
      );
    }
    if (!this.sid) await this.login();

    try {
      const response = await this.http.post(`/${endpoint}`, data, {
        headers: { "X-chkp-sid": this.sid },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.sid = undefined;
        await this.login();
        try {
          const retry = await this.http.post(`/${endpoint}`, data, {
            headers: { "X-chkp-sid": this.sid },
          });
          return retry.data;
        } catch (retryError) {
          throw sanitizedApiError(retryError);
        }
      }
      throw sanitizedApiError(error);
    }
  }
}
