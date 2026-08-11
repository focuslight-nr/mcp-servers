import { mkdir, open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface TargetLock {
  path: string;
  release(): Promise<void>;
}

export async function acquireTargetLock(
  stateDirectory: string,
  target: string,
  staleAfterMs: number,
): Promise<TargetLock> {
  const lockDirectory = join(stateDirectory, "locks");
  const path = join(lockDirectory, `${target}.lock`);
  await mkdir(lockDirectory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }),
      );
      await handle.close();
      return {
        path,
        async release(): Promise<void> {
          try {
            await unlink(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(path);
      if (Date.now() - info.mtimeMs <= staleAfterMs) {
        throw new Error(
          `Target ${target} is already locked by another runner: ${path}`,
        );
      }
      await unlink(path);
    }
  }
  throw new Error(`Unable to acquire target lock: ${target}`);
}
