import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { bindZod3Tools } from '../dist/tools/register-tool.js';

test('registration preserves parsing, defaults and session context', async (t) => {
  let calls = 0;
  const server = new McpServer({ name: 'fixture', version: '1' });
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  st.sessionId = 'session-one';

  const register = bindZod3Tools(server);

  register(
    'typed',
    { inputSchema: { name: z.string(), count: z.number().int().default(1) } },
    async (args, extra) => {
      calls++;
      assert.equal(extra.sessionId, 'session-one');
      return { content: [{ type: 'text', text: JSON.stringify(args) }] };
    }
  );

  register(
    'noargs',
    { description: 'no args' },
    async (extra) => {
      assert.equal(extra.sessionId, 'session-one');
      return { content: [{ type: 'text', text: 'ok' }] };
    }
  );

  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);

  const res1 = await client.callTool({ name: 'typed', arguments: { name: 'Alice' } });
  assert.equal(calls, 1);
  assert.equal(res1.content[0].text, JSON.stringify({ name: 'Alice', count: 1 }));

  const res2 = await client.callTool({ name: 'typed', arguments: { name: 123 } });
  assert.ok(res2.isError);
  assert.equal(calls, 1);

  const res3 = await client.callTool({ name: 'noargs', arguments: {} });
  assert.equal(res3.content[0].text, 'ok');

});
