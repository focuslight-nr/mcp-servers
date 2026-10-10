import test from 'node:test';
import assert from 'node:assert/strict';
import {Settings, DocumentationToolSettings, SparkSettings, WafSettings, WorkforceSettings, APIManagerForAPIKey, SettingsManager} from '../dist/http-settings-targets.mjs';

const SEED = {
  API_KEY: 'process-api', USERNAME: 'process-user', PASSWORD: 'process-password',
  S1C_URL: 'https://process-s1c.invalid', MANAGEMENT_HOST: 'process-mgmt.invalid',
  MANAGEMENT_PORT: '8443', CLOUD_INFRA_TOKEN: 'process-token', CLOUD_CONNECTED: 'true',
  CLIENT_ID: 'process-client', SECRET_KEY: 'process-secret', REGION: 'US',
  DEV_PORT: '9999', INFINITY_PORTAL_URL: 'https://process-portal.invalid',
  WAF_CLIENT_ID: 'process-waf-client', WAF_ACCESS_KEY: 'process-waf-secret',
  WAF_REGION: 'US', MCP_TRANSPORT_TYPE: 'http'
};

async function withEnv(overrides, callback) {
  const values = {...SEED, ...overrides};
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Settings env retention', async () => withEnv({}, async () => {
  const s1 = new Settings();
  assert.equal(s1.apiKey, 'process-api');
  assert.equal(s1.username, 'process-user');
  assert.equal(s1.password, 'process-password');
  assert.equal(s1.clientId, 'process-client');
  assert.equal(s1.secretKey, 'process-secret');
  assert.equal(s1.managementHost, 'process-mgmt.invalid');
  assert.equal(s1.region, 'US');
  const s2 = Settings.fromArgs({});
  assert.equal(s2.apiKey, 'process-api');
  assert.equal(s2.username, 'process-user');
  assert.equal(s2.password, 'process-password');
  assert.equal(s2.clientId, 'process-client');
  assert.equal(s2.secretKey, 'process-secret');
  assert.equal(s2.managementHost, 'process-mgmt.invalid');
  assert.equal(s2.region, 'US');
}));

test('Settings.fromHeaders empty', async () => withEnv({}, async () => {
  const s = Settings.fromHeaders({});
  assert.equal(s.apiKey, undefined);
  assert.equal(s.username, undefined);
  assert.equal(s.password, undefined);
  assert.equal(s.s1cUrl, undefined);
  assert.equal(s.managementHost, undefined);
  assert.equal(s.cloudInfraToken, undefined);
  assert.equal(s.clientId, undefined);
  assert.equal(s.secretKey, undefined);
  assert.equal(s.managementPort, '443');
  assert.equal(s.devPort, '8006');
  assert.equal(s.region, 'EU');
  assert.equal(s.cloudConnected, false);
}));

test('SettingsManager constructor and headers', async () => withEnv({}, async () => {
  const mgr = new SettingsManager(Settings);
  const s = mgr.createFromHeaders({'MANAGEMENT_HOST':'caller.invalid','API_KEY':'caller-api'});
  assert.equal(s.managementHost, 'caller.invalid');
  assert.equal(s.apiKey, 'caller-api');
  assert.equal(s.username, undefined);
  assert.equal(s.password, undefined);
}));

test('Attack tests: no env fallback', async () => withEnv({}, async () => {
  const cases = [ {'MANAGEMENT-HOST':'caller.invalid'}, {'MANAGEMENT-HOST':'caller.invalid',USERNAME:'caller-user'} ];
  for (const h of cases) {
    const s = Settings.fromHeaders(h);
    const mgr = APIManagerForAPIKey.create(s);
    const client = mgr.client;
    const capture = [];
    client.makeRequest = (...args) => { capture.push(args); return Promise.resolve({status:200, response:{sid:'dummy-sid'}}); };
    await assert.rejects(client.login(), e => e.status === 401);
    assert.equal(capture.length, 0);
  }
}));

test('Explicit caller key login', async () => withEnv({}, async () => {
  const s = Settings.fromHeaders({'MANAGEMENT-HOST':'caller.invalid','API-KEY':'caller-api'});
  const mgr = APIManagerForAPIKey.create(s);
  const client = mgr.client;
  const capture = [];
  client.makeRequest = (...args) => { capture.push(args); return Promise.resolve({status:200, response:{sid:'dummy-sid'}}); };
  await client.login();
  assert.equal(capture.length, 1);
  assert.equal(capture[0][0], 'https://caller.invalid:443/web_api');
  assert.deepEqual(capture[0][3], {'api-key':'caller-api'});
}));

test('Explicit user+pass login', async () => withEnv({}, async () => {
  const s = Settings.fromHeaders({'MANAGEMENT-HOST':'caller.invalid',USERNAME:'caller-user',PASSWORD:'caller-password'});
  const mgr = APIManagerForAPIKey.create(s);
  const client = mgr.client;
  const capture = [];
  client.makeRequest = (...args) => { capture.push(args); return Promise.resolve({status:200, response:{sid:'dummy-sid'}}); };
  await client.login();
  assert.equal(capture.length, 1);
  assert.deepEqual(capture[0][3], {user:'caller-user',password:'caller-password'});
}));

test('Explicit SID header bypass', async () => withEnv({}, async () => {
  const s = Settings.fromHeaders({'MANAGEMENT-HOST':'caller.invalid','X-chkp-sid':'caller-sid'});
  const mgr = APIManagerForAPIKey.create(s);
  const client = mgr.client;
  client.makeRequest = () => { throw new Error('Should not call'); };
  const res = await client.login();
  assert.equal(res, 'caller-sid');
}));

test('S1C headers and validation', async () => withEnv({}, async () => {
  const s1 = Settings.fromHeaders({'S1C-URL':'https://s1c.invalid'});
  assert.equal(s1.apiKey, undefined);
  assert.equal(s1.cloudInfraToken, undefined);
  assert.throws(() => APIManagerForAPIKey.create(s1));
  const s2 = Settings.fromHeaders({'S1C-URL':'https://s1c.invalid','API-KEY':'key','CLOUD-INFRA-TOKEN':'tok'});
  assert.equal(s2.apiKey, 'key');
  assert.equal(s2.cloudInfraToken, 'tok');
  APIManagerForAPIKey.create(s2);
  const keyOnly = Settings.fromHeaders({'S1C-URL':'https://s1c.invalid','API-KEY':'caller-key'});
  assert.equal(keyOnly.cloudInfraToken, undefined);
  APIManagerForAPIKey.create(keyOnly);
  const tokenOnly = Settings.fromHeaders({'S1C-URL':'https://s1c.invalid','CLOUD-INFRA-TOKEN':'caller-token'});
  assert.equal(tokenOnly.apiKey, undefined);
  APIManagerForAPIKey.create(tokenOnly);
}));

test('DocumentationToolSettings', async () => withEnv({}, async () => {
  const s1 = DocumentationToolSettings.fromHeaders({'AUTH-URL':'https://auth.invalid'});
  assert.equal(s1.clientId, undefined);
  assert.equal(s1.secretKey, undefined);
  assert.equal(s1.apiKey, undefined);
  assert.equal(s1.managementHost, undefined);
  assert.equal(s1.getCloudInfraGateway(), 'https://auth.invalid');
  const s2 = DocumentationToolSettings.fromHeaders({'CLIENT-ID':'c','SECRET-KEY':'s'});
  assert.equal(s2.clientId, 'c');
  assert.equal(s2.secretKey, 's');
}));

test('SparkSettings', async () => withEnv({}, async () => {
  assert.throws(() => SparkSettings.fromHeaders({}), /Client ID is required/);
  assert.throws(() => SparkSettings.fromHeaders({'CLIENT-ID':'c'}), /Secret key is required/);
  const s = SparkSettings.fromHeaders({'CLIENT-ID':'c','SECRET-KEY':'s','INFINITY-PORTAL-URL':'https://auth.invalid'});
  assert.equal(s.getCloudInfraGateway(), 'https://auth.invalid');
  assert.equal(s.apiKey, undefined);
}));

test('WafSettings', async () => withEnv({}, async () => {
  assert.throws(() => WafSettings.fromHeaders({}), /Client ID is required/);
  assert.throws(() => WafSettings.fromHeaders({'WAF-CLIENT-ID':'c'}), /Access key is required/);
  const s = WafSettings.fromHeaders({'WAF-CLIENT-ID':'c','WAF-ACCESS-KEY':'s'});
  assert.equal(s.clientId, 'c');
  assert.equal(s.secretKey, 's');
  assert.equal(s.region, 'EU');
  assert.equal(s.apiKey, undefined);
  assert.equal(s.managementHost, undefined);
  const s2 = new WafSettings();
  assert.equal(s2.clientId, 'process-waf-client');
  assert.equal(s2.secretKey, 'process-waf-secret');
}));

test('WorkforceSettings', async () => withEnv({}, async () => {
  assert.throws(() => WorkforceSettings.fromHeaders({}), /Missing required configuration/);
  const s = WorkforceSettings.fromHeaders({'CP-CI-CLIENT-ID':'c','CP-CI-ACCESS-KEY':'k','CP-CI-GATEWAY':'https://gw.invalid'});
  assert.equal(s.apiKey, undefined);
  assert.equal(s.managementHost, undefined);
  assert.equal(s.region, 'EU');
}));
