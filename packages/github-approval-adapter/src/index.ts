#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { collectGithubApprovalRecords } from "./adapter.js";
import { loadGithubApprovalConfig, requireGithubToken } from "./config.js";
import { GithubRestClient } from "./github-client.js";

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
const server = new McpServer({
  name: "@focuslight-nr/checkpoint-github-approval-adapter-mcp",
  version: "0.1.0",
});
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

registerTool(
  "get_github_pr_approval_records",
  "Read an allowlisted GitHub pull request and convert current, policy-compliant reviews into Approval Record Format v1. This tool never writes to GitHub or a target.",
  {
    repository: z.string().min(3).max(200),
    pull_request_number: z.number().int().positive(),
    change_plan: z.record(z.unknown()),
    evaluated_at: z.string().datetime().optional(),
  },
  async (args: {
    repository: string;
    pull_request_number: number;
    change_plan: unknown;
    evaluated_at?: string;
  }) => {
    try {
      const result = await collectGithubApprovalRecords(
        {
          repository: args.repository,
          pullRequestNumber: args.pull_request_number,
          changePlan: args.change_plan,
          evaluatedAt: args.evaluated_at,
        },
        loadGithubApprovalConfig(process.env),
        new GithubRestClient(requireGithubToken(process.env)),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: (error as Error).message }, null, 2),
          },
        ],
      };
    }
  },
);

const main = async (): Promise<void> =>
  server.connect(new StdioServerTransport());
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

export { collectGithubApprovalRecords } from "./adapter.js";
export { loadGithubApprovalConfig, requireGithubToken } from "./config.js";
export { GithubRestClient } from "./github-client.js";
export { formatGithubPlanMarker, parseGithubPlanMarker } from "./marker.js";
export type {
  GithubApprovalConfig,
  GithubApprovalResult,
  GithubApprovalSource,
  GithubPullRequest,
  GithubReview,
} from "./types.js";
