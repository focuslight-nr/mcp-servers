export interface GaiaCredentials {
  username: string;
  password: string;
  caFile?: string;
}

export interface GaiaCredentialProvider {
  getCredentials(profile?: string): GaiaCredentials;
  assertTargetAllowed(target: string): void;
}

function profileSuffix(profile: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw new Error(
      "credential_profile may contain only letters, numbers, underscore, and hyphen",
    );
  }
  return profile.toUpperCase().replace(/-/g, "_");
}

export function credentialEnvironmentNames(profile?: string): {
  username: string;
  password: string;
  caFile: string;
} {
  if (!profile) {
    return {
      username: "GAIA_USERNAME",
      password: "GAIA_PASSWORD",
      caFile: "GAIA_CA_FILE",
    };
  }
  const suffix = profileSuffix(profile);
  return {
    username: `GAIA_CREDENTIAL_${suffix}_USERNAME`,
    password: `GAIA_CREDENTIAL_${suffix}_PASSWORD`,
    caFile: `GAIA_CREDENTIAL_${suffix}_CA_FILE`,
  };
}

export class EnvironmentCredentialProvider implements GaiaCredentialProvider {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  getCredentials(profile?: string): GaiaCredentials {
    const names = credentialEnvironmentNames(profile);
    const username = this.environment[names.username]?.trim();
    const password = this.environment[names.password];
    if (!username || !password) {
      throw new Error(
        `Missing Gaia credentials. Set ${names.username} and ${names.password}.`,
      );
    }
    return {
      username,
      password,
      caFile:
        this.environment[names.caFile]?.trim() ||
        this.environment.GAIA_CA_FILE?.trim(),
    };
  }

  assertTargetAllowed(target: string): void {
    const configured = this.environment.GAIA_ALLOWED_TARGETS;
    if (!configured?.trim()) {
      throw new Error(
        "GAIA_ALLOWED_TARGETS is required and must list exact permitted gateway hosts or IP addresses.",
      );
    }
    const allowed = configured
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(target.trim().toLowerCase())) {
      throw new Error(`Gaia target is not allowed: ${target}`);
    }
  }
}
