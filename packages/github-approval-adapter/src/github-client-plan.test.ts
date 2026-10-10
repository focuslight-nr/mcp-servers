import assert from "node:assert/strict";
import test from "node:test";
import { GithubRestClient } from "./github-client.js";

const sha = "a".repeat(40);
const file = (bytes = Buffer.from('{"ok":true}')) => ({
  type: "file", path: ".checkpoint/change-plan.json", encoding: "base64",
  size: bytes.length, content: bytes.toString("base64"),
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("loads a fixed path at the full SHA without following download URLs", async () => {
  let calls = 0;
  const value = file();
  const client = new GithubRestClient("dummy-token", async (url, init) => {
    calls++;
    assert.equal(String(url), `https://api.github.com/repos/x/y/contents/.checkpoint/change-plan.json?ref=${sha}`);
    assert.equal(init!.redirect, "error");
    assert.equal(new Headers(init!.headers).get("Authorization"), "Bearer dummy-token");
    return response({ ...value, content: value.content.slice(0, 4) + "\n" + value.content.slice(4) + "\n", download_url: "https://example.invalid/plan" });
  });
  assert.deepEqual(await client.getCommittedChangePlan("x/y", sha), { ok: true });
  assert.equal(calls, 1);
});

test("rejects unsupported files, encodings, size, UTF-8 and JSON", async () => {
  const value = file();
  for (const invalid of [
    { ...value, type: "symlink" }, [value], { ...value, encoding: "none" },
    { ...value, path: "other.json" }, { ...value, content: "%%%" },
    { ...value, size: value.size + 1 }, { ...value, size: 1048577 },
    file(Buffer.from([255])), file(Buffer.from("not JSON")),
  ]) {
    const client = new GithubRestClient("dummy-token", async () => response(invalid));
    await assert.rejects(() => client.getCommittedChangePlan("x/y", sha));
  }
});

test("mutable or abbreviated refs fail before a network request", async () => {
  let calls = 0;
  const client = new GithubRestClient("dummy-token", async () => { calls++; return response(file()); });
  for (const ref of ["main", "abc123", `${sha}&ref=main`])
    await assert.rejects(() => client.getCommittedChangePlan("x/y", ref), /full Git commit SHA/);
  assert.equal(calls, 0);
});

test("missing committed file errors do not include response contents", async () => {
  const client = new GithubRestClient("dummy-token", async () => response({ message: "private repository details" }, 404));
  await assert.rejects(() => client.getCommittedChangePlan("x/y", sha), { message: "GitHub API request failed with HTTP 404" });
});
