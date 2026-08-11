import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpProcessConfig } from "./types.js";

function childEnvironment(forward: string[] = []): Record<string, string> {
  const environment = getDefaultEnvironment();
  for (const name of forward) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

export class ProcessMcpClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;

  constructor(
    name: string,
    processConfig: Required<Pick<McpProcessConfig, "command" | "args">> &
      McpProcessConfig,
  ) {
    this.client = new Client({
      name: `baseline-audit-runner-${name}`,
      version: "0.1.0",
    });
    this.transport = new StdioClientTransport({
      command: processConfig.command,
      args: processConfig.args,
      cwd: processConfig.cwd,
      env: childEnvironment(processConfig.forwardEnvironment),
      stderr: "inherit",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.client.callTool({ name, arguments: args }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(`MCP tool ${name} timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function assertToolSucceeded(response: unknown, toolName: string): void {
  if (!response || typeof response !== "object") {
    throw new Error(`${toolName} returned an invalid MCP response`);
  }
  const record = response as { isError?: boolean; content?: unknown[] };
  const text =
    record.content
      ?.filter(
        (item): item is { type: string; text: string } =>
          typeof item === "object" &&
          item !== null &&
          (item as { type?: unknown }).type === "text" &&
          typeof (item as { text?: unknown }).text === "string",
      )
      .map((item) => item.text)
      .join("\n") ?? "";
  if (record.isError || /^Error(?:\s|:)/im.test(text)) {
    throw new Error(`${toolName} failed: ${text || "MCP error"}`);
  }
}

export function textBlocks(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];
  const content = (response as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      return [(item as { text: string }).text];
    }
    return [];
  });
}
