import type { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type Result = CallToolResult | Promise<CallToolResult>;

interface RegisterZod3Tool {
    <Shape extends z.ZodRawShape>(
        name: string,
        config: { description?: string; inputSchema: Shape },
        callback: (args: z.output<z.ZodObject<Shape>>, extra: Extra) => Result
    ): RegisteredTool;
    (
        name: string,
        config: { description?: string; inputSchema?: undefined },
        callback: (extra: Extra) => Result
    ): RegisteredTool;
}

/**
 * Argos uses Zod 3 raw shapes only. Narrow the SDK's Zod 3/4 generic
 * signature to prevent recursive cross-version inference in TypeScript.
 * The bound SDK method still parses every input and supplies its original
 * request context; this adapter does not replace runtime validation.
 */
export function bindZod3Tools(server: McpServer): RegisterZod3Tool {
    return server.registerTool.bind(server) as unknown as RegisterZod3Tool;
}
