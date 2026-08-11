#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EnvironmentCredentialProvider } from "./credentials.js";
import { GaiaReadOnlyService } from "./service.js";
import type { GaiaToolTarget } from "./service.js";

interface ToolArgs {
  gateway_ip?: string;
  port?: number;
  credential_profile?: string;
  member_id?: string;
  virtual_system_id?: number;
}

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const server = new McpServer({
  name: "@focuslight-nr/checkpoint-gaia-readonly-collector-mcp",
  version: "0.1.0",
});
const service = new GaiaReadOnlyService(new EnvironmentCredentialProvider());

// TypeScript 5.0 cannot fully instantiate the SDK 1.29 + Zod tool overloads.
const registerTool = (
  server as unknown as {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: any) => Promise<ToolResponse>,
    ) => void;
  }
).tool.bind(server);

const commonSchema = {
  gateway_ip: z
    .string()
    .min(1)
    .describe(
      "Exact gateway IPv4 address or DNS hostname from GAIA_ALLOWED_TARGETS",
    ),
  port: z.number().int().min(1).max(65535).optional().default(443),
  credential_profile: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  member_id: z.string().optional(),
};

function target(args: ToolArgs): GaiaToolTarget {
  if (!args.gateway_ip) throw new Error("gateway_ip is required");
  return {
    gatewayIp: args.gateway_ip,
    port: args.port ?? 443,
    credentialProfile: args.credential_profile,
    memberId: args.member_id,
    virtualSystemId: args.virtual_system_id,
  };
}

async function execute(
  operation: () => Promise<unknown>,
): Promise<ToolResponse> {
  try {
    const result = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
    };
  }
}

registerTool(
  "show_dns",
  "Read DNS configuration from an explicitly allowlisted Gaia gateway. This tool cannot change configuration.",
  {
    ...commonSchema,
    virtual_system_id: z.number().int().optional(),
  },
  async (args: ToolArgs) => execute(() => service.showDns(target(args))),
);

registerTool(
  "show_dhcp",
  "Read DHCP server configuration from an explicitly allowlisted Gaia gateway. This tool cannot change configuration.",
  {
    ...commonSchema,
    virtual_system_id: z.number().int().optional(),
  },
  async (args: ToolArgs) => execute(() => service.showDhcp(target(args))),
);

registerTool(
  "show_date_time",
  "Read NTP, current timezone, and available timezones from an explicitly allowlisted Gaia gateway. This tool cannot change configuration.",
  commonSchema,
  async (args: ToolArgs) => execute(() => service.showDateTime(target(args))),
);

export { EnvironmentCredentialProvider, GaiaReadOnlyService, server };
export type { GaiaCredentialProvider, GaiaCredentials } from "./credentials.js";

const main = async (): Promise<void> => {
  await server.connect(new StdioServerTransport());
};

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
