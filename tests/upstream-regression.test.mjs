import * as A from '../packages/argos-erm/dist/session.js';
import { ALL_SENTINEL } from '../packages/argos-erm/dist/constants.js';
import * as CP from '../packages/cpinfo-analysis/dist/paths.js';
import * as CV from '../packages/cpview-history-mcp/dist/paths.js';
import { strict as assert } from 'node:assert';
import { test, describe, before, after } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Argos Session Isolation', () => {
    const extraA = { sessionId: 'test-a' };
    const extraB = { sessionId: 'test-b' };

    before(() => {
        A.configureInitialCustomerId(() => undefined);
    });

    test('sessions are independent and isolated', async () => {
        const apiA = {
            post: async () => ({
                json: async () => ({
                    data: { customers: [{ customer_id: 'a', customer_name: 'A', region: 'US' }] }
                })
            })
        };

        const apiB = {
            post: async () => ({
                json: async () => ({
                    data: { customers: [{ customer_id: 'b', customer_name: 'B', region: 'EU' }] }
                })
            })
        };

        await A.populateCustomers(apiA, extraA);
        const customersA = A.getCustomers(extraA);
        assert.equal(customersA.length, 1);
        assert.equal(customersA[0].customer_id, 'a');

        await A.populateCustomers(apiB, extraB);
        const customersB = A.getCustomers(extraB);
        assert.equal(customersB.length, 1);
        assert.equal(customersB[0].customer_id, 'b');

        assert.equal(A.getCustomers(extraA)[0].customer_id, 'a');
        assert.equal(A.getCustomers(extraB)[0].customer_id, 'b');

        const resolvedA = A.resolveCustomerId(undefined, extraA);
        assert.equal(resolvedA, 'a');

        const resolvedB = A.resolveCustomerId(undefined, extraB);
        assert.equal(resolvedB, 'b');

        assert.equal(A.resolveCustomerId('a', extraA), 'a');

        assert.throws(() => {
            A.resolveCustomerId('b', extraA);
        }, A.UnknownCustomerError);

        A.resetSession(extraA);
        const sessionAAfterReset = A.getSession(extraA);
        assert.equal(sessionAAfterReset.customer_id, ALL_SENTINEL);

        const sessionBAfterResetA = A.getSession(extraB);
        assert.equal(sessionBAfterResetA.customer_id, 'b');
    });
});

describe('Filesystem Confinement', () => {
    let tmpDir = '';
    let allowedDir = '';
    let outsideDir = '';
    let linkPath = '';
    const originalRoots = { CPINFO_ALLOWED_ROOTS: process.env.CPINFO_ALLOWED_ROOTS, CPVIEW_ALLOWED_ROOTS: process.env.CPVIEW_ALLOWED_ROOTS };

    before(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
        allowedDir = path.join(tmpDir, 'allowed');
        outsideDir = path.join(tmpDir, 'outside');

        await fs.mkdir(allowedDir, { recursive: true });
        await fs.mkdir(outsideDir, { recursive: true });

        await fs.writeFile(path.join(allowedDir, 'safe.txt'), 'data');

        await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');

        linkPath = path.join(allowedDir, 'link_to_outside');
        await fs.symlink(outsideDir, linkPath);
    });

    after(async () => {
        try {
            await fs.rm(tmpDir, { recursive: true, force: true });
        } finally {
            for (const [name, value] of Object.entries(originalRoots)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    });

    test('CP async wrapper allows inside, rejects outside', async () => {
        process.env.CPINFO_ALLOWED_ROOTS = allowedDir;


        await assert.doesNotReject(async () => {
            await CP.withUserPath(path.join(allowedDir, 'safe.txt'), async (resolved) => {
                assert.ok(resolved.endsWith('safe.txt'));
                return resolved;
            });
        });

        await assert.rejects(async () => {
            await CP.withUserPath(path.join(outsideDir, 'secret.txt'), async () => {});
        });

        await assert.rejects(async () => {
            await CP.withUserPath(path.join(allowedDir, '..', 'outside', 'secret.txt'), async () => {});
        });

        if (linkPath) {
            await assert.rejects(async () => {
                await CP.withUserPath(path.join(linkPath, 'secret.txt'), async () => {});
            });
        }

        await assert.rejects(CP.withUserPath(path.join(linkPath, 'new', 'output.csv'), async () => {}));
        delete process.env.CPINFO_ALLOWED_ROOTS;
    });

    test('CV synchronous wrapper allows inside, rejects outside', () => {
        process.env.CPVIEW_ALLOWED_ROOTS = allowedDir;

        assert.doesNotThrow(() => {
            const result = CV.withUserPath(path.join(allowedDir, 'safe.txt'), (resolved) => {
                assert.ok(resolved.endsWith('safe.txt'));
                return resolved;
            });
            return result;
        });

        assert.throws(() => {
            CV.withUserPath(path.join(outsideDir, 'secret.txt'), () => {});
        });

        assert.throws(() => {
            CV.withUserPath(path.join(allowedDir, '..', 'outside', 'secret.txt'), () => {});
        });

        if (linkPath) {
            assert.throws(() => {
                CV.withUserPath(path.join(linkPath, 'secret.txt'), () => {});
            });
        }

        assert.throws(() => CV.withUserPath(path.join(linkPath, 'new', 'output.csv'), () => {}));
        delete process.env.CPVIEW_ALLOWED_ROOTS;
    });

    test('Unset roots keeps legacy access outside', async () => {
        delete process.env.CPINFO_ALLOWED_ROOTS;
        delete process.env.CPVIEW_ALLOWED_ROOTS;

        await assert.doesNotReject(async () => {
            await CP.withUserPath(path.join(outsideDir, 'secret.txt'), async (resolved) => {
                assert.ok(resolved.endsWith('secret.txt'));
                return resolved;
            });
        });

        assert.doesNotThrow(() => {
            const result = CV.withUserPath(path.join(outsideDir, 'secret.txt'), (resolved) => {
                assert.ok(resolved.endsWith('secret.txt'));
                return resolved;
            });
            return result;
        });
    });

    test('Invalid configured root fails closed', async () => {
        const invalidRoot = path.join(tmpDir, 'nonexistent');

        process.env.CPINFO_ALLOWED_ROOTS = invalidRoot;

        await assert.rejects(async () => {
            await CP.withUserPath(path.join(allowedDir, 'safe.txt'), async () => {});
        });

        process.env.CPVIEW_ALLOWED_ROOTS = invalidRoot;
        assert.throws(() => {
            CV.withUserPath(path.join(allowedDir, 'safe.txt'), () => {});
        });

        delete process.env.CPINFO_ALLOWED_ROOTS;
        delete process.env.CPVIEW_ALLOWED_ROOTS;
    });
});
