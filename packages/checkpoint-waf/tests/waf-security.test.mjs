import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGraphQLDocument, resolveWriteAccess, WriteOperationBlockedError } from '../dist/graphql-guard.js';
import { CheckPointWAFAPIManager } from '../dist/api-manager.js';
import { resolveSessionWriteAccess } from '../dist/settings.js';

function makeManager(settings = {}) {
  const calls = [];
  const manager = {
    settings: { allowWrites: false, ...settings },
    executeGraphQL: async (q, v) => { calls.push({ q, v }); return { ok: true }; }
  };
  Object.setPrototypeOf(manager, CheckPointWAFAPIManager.prototype);
  return { manager, calls };
}

test('classifyGraphQLDocument returns objects with readOnly boolean', () => {
  assert.equal(classifyGraphQLDocument('{ __typename }').readOnly, true);
  assert.equal(classifyGraphQLDocument('query Q { f }').readOnly, true);
  assert.equal(classifyGraphQLDocument('# comment\nmutation M { f }').readOnly, false);
  assert.equal(classifyGraphQLDocument(', mutation M { f }').readOnly, false);
  assert.equal(classifyGraphQLDocument('fragment F on T { f }\nmutation M { ...F }').readOnly, false);
  assert.equal(classifyGraphQLDocument('subscription S { f }').readOnly, false);
  assert.equal(classifyGraphQLDocument('{ q } mutation M { f }').readOnly, false);
  assert.equal(classifyGraphQLDocument('invalid syntax').readOnly, false);
});

test('resolveWriteAccess covers all boolean combinations', () => {
  assert.equal(resolveWriteAccess(true, true), true);
  assert.equal(resolveWriteAccess(true, false), false);
  assert.equal(resolveWriteAccess(false, true), false);
  assert.equal(resolveWriteAccess(false, false), false);
});

test('rejects write operations when allowWrites is false', async () => {
  const writes = [
    '# comment\nmutation M { f }',
    ', mutation M { f }',
    'fragment F on T { f }\nmutation M { ...F }',
    'subscription S { f }',
    '{ q } mutation M { f }',
    'invalid syntax'
  ];
  for (const query of writes) {
    const { manager, calls } = makeManager({ allowWrites: false });
    await assert.rejects(
      manager.executeUserGraphQL(query, {}, { allowWrites: false }),
      WriteOperationBlockedError
    );
    assert.equal(calls.length, 0);
  }
});

test('forwards legitimate queries and allowed mutations', async () => {
  const { manager, calls } = makeManager({ allowWrites: true });
  await manager.executeUserGraphQL('{ __typename }', { v: 1 }, { allowWrites: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, '{ __typename }');
  assert.equal(calls[0].v.v, 1);

  calls.length = 0;
  await manager.executeUserGraphQL('mutation M { f }', {}, { allowWrites: true });
  assert.equal(calls.length, 1);
});

test('callApi alias cannot bypass comment-prefixed mutation', async () => {
  const { manager, calls } = makeManager({ allowWrites: false });
  await assert.rejects(
    manager.callApi('POST', '/api', { query: '# c\nmutation M { f }' }),
    WriteOperationBlockedError
  );
  assert.equal(calls.length, 0);
});

test('resolveSessionWriteAccess truth table and edge cases', () => {
  assert.equal(resolveSessionWriteAccess(undefined, true), true);
  assert.equal(resolveSessionWriteAccess(undefined, false), false);
  assert.equal(resolveSessionWriteAccess(true, false), false);
  assert.equal(resolveSessionWriteAccess('true', false), false);
  assert.equal(resolveSessionWriteAccess(false, true), false);
  assert.equal(resolveSessionWriteAccess('false', true), false);
  assert.equal(resolveSessionWriteAccess('1', true), false);
  assert.equal(resolveSessionWriteAccess('yes', true), false);
  assert.equal(resolveSessionWriteAccess(true, true), true);
  assert.equal(resolveSessionWriteAccess('true', true), true);
});
