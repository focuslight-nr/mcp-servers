import test from 'node:test';
import assert from 'node:assert/strict';
import { CPMcpServer } from '../packages/mcp-utils/dist/mcp-server.js';
import { createServerModule } from '../packages/mcp-utils/dist/server-utils.js';
import { mirrorBooleanFlagsToEnv } from '../packages/mcp-utils/dist/launcher.js';

await test('real SDK registered tool handles enabled flag', async () => {
    const factory = () => new CPMcpServer({ name: 'test', version: '1' });
    const template = factory();

    const module = createServerModule(
        template,
        class {},
        { version: '1' },
        class {},
        (name) => name === 'read',
        factory
    );

    template.tool('read', 'read', {}, async () => ({ content: [] }));
    template.tool('write', 'write', {}, async () => ({ content: [] }));

    const server = module.createServerInstance();

    assert.equal(server._registeredTools.read.enabled, true);
    assert.equal(server._registeredTools.write.enabled, false);
    assert.equal(template.getToolPolicy(), server.getToolPolicy());
    assert.notEqual(module.createServerInstance(), template);
});

await test('mirrorBooleanFlagsToEnv configuration sets env', async () => {
    const originalValue = process.env.TEST_UPSTREAM_WRITE;

    try {
        mirrorBooleanFlagsToEnv(
            { name: 'test', options: [{ flag: '--write-mode', type: 'boolean', env: 'TEST_UPSTREAM_WRITE' }] },
            { writeMode: true }
        );

        assert.equal(process.env.TEST_UPSTREAM_WRITE, 'true');
    } finally {
        if (originalValue === undefined) {
            delete process.env.TEST_UPSTREAM_WRITE;
        } else {
            process.env.TEST_UPSTREAM_WRITE = originalValue;
        }
    }
});

await test('negated --no-write with env throws', async () => {
    assert.throws(() => {
        mirrorBooleanFlagsToEnv(
            { name: 'test', options: [{ flag: '--no-write', type: 'boolean', env: 'TEST_UPSTREAM_WRITE' }] },
            { noWrite: true }
        );
    });
});
