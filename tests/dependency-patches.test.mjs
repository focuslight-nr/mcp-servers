import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const braces = require('braces');
const forge = require('node-forge');
const readYamlFile = require('read-yaml-file');
const { loadNycConfig } = require('@istanbuljs/load-nyc-config');
test('ordinary braces compile, expand, stringify', () => {
  const pattern = 'a/{b,c}/d';
  assert.equal(braces.compile(pattern), 'a/(b|c)/d');
  assert.deepEqual(braces.expand(pattern), ['a/b/d', 'a/c/d']);
  assert.equal(braces.stringify(braces.parse(pattern)), pattern);
});

test('guard tests for deep nesting strings', () => {
  const deepBrace = '{'.repeat(600) + 'x' + '}'.repeat(600);
  const deepParen = '('.repeat(600) + 'x' + ')'.repeat(600);
  const mixed = ('{('.repeat(300)) + 'x' + (')}'.repeat(300));
  const unclosed = '{'.repeat(600) + 'x';

  for (const fn of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => fn(deepBrace), {name: 'SyntaxError', message: /nesting depth/});
    assert.throws(() => fn(deepParen), /nesting depth/);
    assert.throws(() => fn(mixed), /nesting depth/);
    assert.throws(() => fn(unclosed), SyntaxError);
  }

  // OPTIONS maxDepth:Infinity cannot disable guard for braces (internal limit)
  assert.throws(() => braces.compile(deepBrace, { maxDepth: Infinity }), /nesting depth/);
});

test('manually constructed AST throws nesting depth', () => {
  const makeTree = () => {
    let current = { type: 'text', value: 'x' };
    for (let i = 0; i < 600; i++) {
      current = { type: 'paren', nodes: [current] };
    }
    return { type: 'root', nodes: [current] };
  };

  for (const fn of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => fn(makeTree()), {name: 'SyntaxError', message: /nesting depth/});
  }
});

test('depth boundary, escaped literals and ordinary ranges remain supported', () => {
  const boundary = '{'.repeat(128) + 'a,b' + '}'.repeat(128);
  for (const fn of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.doesNotThrow(() => fn(boundary));
  }
  assert.deepEqual(braces.expand('file-{1..3}.ts'), ['file-1.ts', 'file-2.ts', 'file-3.ts']);
  assert.deepEqual(braces.expand(String.raw`\{literal\}`), ['{literal}']);
  assert.throws(() => braces.expand('{1..2000}'), /range limit/);
});

test('non-string AST values cannot reach recursive array helpers', () => {
  let value = 'b';
  for (let i = 0; i < 12000; i++) value = [value];
  for (const fn of [braces.compile, braces.expand, braces.stringify]) {
    const ast = {type: 'root', nodes: [{type: 'text', value: 'a'}, {type: 'text', value}]};
    assert.throws(() => fn(ast), {name: 'TypeError', message: /AST values must be strings/});
  }
});

test('RSA verification accepts legitimate signatures and rejects malformed DigestAlgorithm', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicExponent: 65537,
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'}
  });
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey);
  const publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  const md = forge.md.sha256.create().update('development regression');
  const digest = md.digest().bytes();
  const signature = privateKey.sign(md);
  assert.equal(publicKey.verify(digest, signature), true);
  assert.equal(publicKey.verify(forge.md.sha256.create().update('altered').digest().bytes(), signature), false);

  const {asn1} = forge;
  const {UNIVERSAL} = asn1.Class;
  const {SEQUENCE, OID, NULL, OCTETSTRING} = asn1.Type;
  const node = (type, value, constructed = false) => asn1.create(UNIVERSAL, type, constructed, value);
  const verify = parameters => {
    const algorithm = node(SEQUENCE, [node(OID, asn1.oidToDer(forge.oids.sha256).getBytes()), ...parameters], true);
    const info = node(SEQUENCE, [algorithm, node(OCTETSTRING, digest)], true);
    // Sign controlled malformed encodings with our own test key; no signature forgery is needed.
    return publicKey.verify(digest, privateKey.sign(asn1.toDer(info).getBytes(), 'NONE'));
  };
  assert.equal(verify([]), true);
  assert.equal(verify([node(NULL, '')]), true);
  for (const parameters of [
    [node(NULL, ''), node(OCTETSTRING, 'ignored')],
    [node(NULL, ''), node(NULL, '')],
    [node(OCTETSTRING, 'ignored')],
    [node(NULL, 'ignored')]
  ]) assert.throws(() => verify(parameters), /DigestInfo/);

  for (const algorithm of ['sha1', 'sha384', 'sha512', 'md5']) {
    const hash = forge.md[algorithm].create().update('ordinary signature');
    assert.equal(publicKey.verify(hash.digest().bytes(), privateKey.sign(hash)), true);
  }
});

test('workspace and coverage YAML retain async/sync parsing without sprintf-js', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dependency-yaml-'));
  try {
    const workspace = join(directory, 'workspace.yaml');
    await writeFile(workspace, '\ufeffpackages:\n  - packages/*\n');
    assert.deepEqual(readYamlFile.sync(workspace), {packages: ['packages/*']});
    assert.deepEqual(await readYamlFile(workspace), {packages: ['packages/*']});
    await writeFile(join(directory, 'package.json'), '{}');
    const coverage = join(directory, '.nycrc.yml');
    await writeFile(coverage, 'all: true\ninclude:\n  - src/**/*.ts\n');
    const config = await loadNycConfig({cwd: directory, nycrcPath: coverage});
    assert.equal(config.all, true);
    assert.deepEqual(config.include, ['src/**/*.ts']);
    const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
    assert.equal(Object.keys(lock.packages).some(path => path.endsWith('/sprintf-js')), false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

