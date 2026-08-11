import assert from "node:assert/strict";
import test from "node:test";
import { GithubRestClient } from "./github-client.js";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("uses fixed GitHub API endpoint, version, bearer token, and pagination", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    const page = new URL(String(input)).searchParams.get("page");
    return response(
      page === "1"
        ? Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            user: { id: 1000, login: "alice" },
            state: "APPROVED",
            html_url: `https://github.com/x/y/pull/1#pullrequestreview-${index + 1}`,
            submitted_at: "2026-08-11T07:30:00.000Z",
            commit_id: "abc",
          }))
        : [],
    );
  };
  const client = new GithubRestClient("secret-token", fetcher);
  assert.equal((await client.listPullRequestReviews("x/y", 1)).length, 100);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /^https:\/\/api\.github\.com\//);
  const headers = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers["X-GitHub-Api-Version"], "2026-03-10");
});

test("redacts response details from GitHub API errors", async () => {
  const client = new GithubRestClient("secret-token", async () =>
    response({ message: "sensitive" }, 403),
  );
  await assert.rejects(
    () => client.getPullRequest("x/y", 1),
    (error: Error) =>
      error.message === "GitHub API request failed with HTTP 403",
  );
});
