import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { diffAuditReports } from "./diff.js";
import { validateException } from "./exceptions.js";
import type { AuditException, AuditReport, StoredAudit } from "./types.js";

interface StoreData {
  version: 1;
  audits: StoredAudit[];
  exceptions: AuditException[];
}

function emptyStore(): StoreData {
  return { version: 1, audits: [], exceptions: [] };
}

function historyLimit(): number {
  const configured = Number(process.env.BASELINE_AUDIT_HISTORY_LIMIT ?? 1000);
  return Number.isInteger(configured) && configured > 0 ? configured : 1000;
}

function baselineIdentity(report: AuditReport): string {
  return report.baselineId ?? report.benchmark;
}

export function defaultStorePath(): string {
  return (
    process.env.BASELINE_AUDIT_STORE_PATH ||
    join(process.cwd(), ".baseline-audit", "history.json")
  );
}

export class AuditStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = defaultStorePath()) {}

  get path(): string {
    return this.filePath;
  }

  private async read(): Promise<StoreData> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<StoreData>;
      return {
        version: 1,
        audits: Array.isArray(parsed.audits) ? parsed.audits : [],
        exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyStore();
      }
      throw new Error(
        `Unable to read audit store ${this.filePath}: ${(error as Error).message}`,
      );
    }
  }

  private async write(data: StoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + 10000;

    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(
            `${process.pid} ${new Date().toISOString()}\n`,
          );
          return await operation();
        } finally {
          await handle.close();
          await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      } catch (error) {
        const fileError = error as NodeJS.ErrnoException;
        if (fileError.code !== "EEXIST") throw error;

        try {
          const lock = await stat(lockPath);
          if (Date.now() - lock.mtimeMs > 60000) {
            await unlink(lockPath);
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw lockError;
        }

        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for audit store lock ${lockPath}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
    }
  }

  private async mutate<T>(
    operation: (data: StoreData) => T | Promise<T>,
  ): Promise<T> {
    const queued = this.mutationQueue.then(() =>
      this.withFileLock(async () => {
        const data = await this.read();
        const result = await operation(data);
        await this.write(data);
        return result;
      }),
    );
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async recordAudit(
    report: AuditReport,
    adapterWarnings: string[] = [],
  ): Promise<StoredAudit> {
    return this.mutate((data) => {
      const previous = [...data.audits]
        .reverse()
        .find(
          (item) =>
            item.report.target === report.target &&
            baselineIdentity(item.report) === baselineIdentity(report),
        );
      const diff = diffAuditReports(previous?.report, report);
      if (previous) {
        diff.previousAuditId = previous.id;
      }
      const stored: StoredAudit = {
        id: randomUUID(),
        recordedAt: new Date().toISOString(),
        report,
        diff,
        adapterWarnings,
      };
      data.audits.push(stored);
      if (data.audits.length > historyLimit()) {
        data.audits.splice(0, data.audits.length - historyLimit());
      }
      return stored;
    });
  }

  async listAudits(target?: string, limit = 20): Promise<StoredAudit[]> {
    const data = await this.read();
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    return data.audits
      .filter(
        (item) =>
          !target || item.report.target.toLowerCase() === target.toLowerCase(),
      )
      .slice(-boundedLimit)
      .reverse();
  }

  async upsertException(exception: AuditException): Promise<AuditException> {
    const errors = validateException(exception);
    if (errors.length > 0) {
      throw new Error(`Invalid audit exception: ${errors.join("; ")}`);
    }
    return this.mutate((data) => {
      const index = data.exceptions.findIndex(
        (item) => item.id === exception.id,
      );
      if (index === -1) {
        data.exceptions.push(exception);
      } else {
        data.exceptions[index] = exception;
      }
      return exception;
    });
  }

  async deleteException(id: string): Promise<boolean> {
    return this.mutate((data) => {
      const before = data.exceptions.length;
      data.exceptions = data.exceptions.filter((item) => item.id !== id);
      return data.exceptions.length !== before;
    });
  }

  async listExceptions(
    target?: string,
    includeExpired = false,
  ): Promise<AuditException[]> {
    const data = await this.read();
    const now = Date.now();
    return data.exceptions.filter((item) => {
      const targetMatches =
        !target ||
        item.target === "*" ||
        item.target.toLowerCase() === target.toLowerCase();
      const expiry = Date.parse(item.expiresAt);
      return (
        targetMatches &&
        (includeExpired || (Number.isFinite(expiry) && expiry > now))
      );
    });
  }
}
