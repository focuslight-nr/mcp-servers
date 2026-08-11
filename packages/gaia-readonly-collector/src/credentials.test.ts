import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialEnvironmentNames,
  EnvironmentCredentialProvider,
} from "./credentials.js";

test("resolves default credentials without exposing values", () => {
  const provider = new EnvironmentCredentialProvider({
    GAIA_USERNAME: "baseline-auditor",
    GAIA_PASSWORD: "secret-value",
    GAIA_ALLOWED_TARGETS: "192.0.2.10, gw-2.example.test",
  });
  assert.deepEqual(provider.getCredentials(), {
    username: "baseline-auditor",
    password: "secret-value",
    caFile: undefined,
  });
  provider.assertTargetAllowed("192.0.2.10");
  assert.throws(
    () => provider.assertTargetAllowed("192.0.2.11"),
    /not allowed/,
  );
});

test("resolves profile-specific environment variable names", () => {
  assert.deepEqual(credentialEnvironmentNames("tokyo-prod"), {
    username: "GAIA_CREDENTIAL_TOKYO_PROD_USERNAME",
    password: "GAIA_CREDENTIAL_TOKYO_PROD_PASSWORD",
    caFile: "GAIA_CREDENTIAL_TOKYO_PROD_CA_FILE",
  });
  const provider = new EnvironmentCredentialProvider({
    GAIA_CREDENTIAL_TOKYO_PROD_USERNAME: "auditor",
    GAIA_CREDENTIAL_TOKYO_PROD_PASSWORD: "profile-secret",
    GAIA_CREDENTIAL_TOKYO_PROD_CA_FILE: "C:/certs/gaia-ca.pem",
  });
  assert.equal(
    provider.getCredentials("tokyo-prod").caFile,
    "C:/certs/gaia-ca.pem",
  );
});

test("requires an explicit target allowlist and complete credentials", () => {
  const provider = new EnvironmentCredentialProvider({});
  assert.throws(
    () => provider.assertTargetAllowed("192.0.2.10"),
    /GAIA_ALLOWED_TARGETS/,
  );
  assert.throws(
    () => provider.getCredentials(),
    /GAIA_USERNAME and GAIA_PASSWORD/,
  );
  assert.throws(
    () => credentialEnvironmentNames("../unsafe"),
    /credential_profile/,
  );
});
