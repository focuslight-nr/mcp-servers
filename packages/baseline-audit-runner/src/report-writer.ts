import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function timestampForFile(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

export async function writeAuditReport(
  directory: string,
  target: string,
  json: string,
  markdown: string,
  timestamp = new Date(),
): Promise<{ jsonPath: string; markdownPath: string }> {
  const targetDirectory = join(directory, target);
  await mkdir(targetDirectory, { recursive: true });
  const basename = timestampForFile(timestamp);
  const jsonPath = join(targetDirectory, `${basename}.json`);
  const markdownPath = join(targetDirectory, `${basename}.md`);
  await Promise.all([
    writeFile(jsonPath, `${json.trim()}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(markdownPath, `${markdown.trim()}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
  ]);
  return { jsonPath, markdownPath };
}
