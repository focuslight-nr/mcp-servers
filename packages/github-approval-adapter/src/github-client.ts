import { z } from "zod";
import type {
  GithubApprovalSource,
  GithubPullRequest,
  GithubReview,
} from "./types.js";

const userSchema = z
  .object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    type: z.string().optional(),
  })
  .passthrough();
const pullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    state: z.string(),
    draft: z.boolean(),
    body: z.string().nullable(),
    html_url: z.string().url(),
    user: userSchema,
    base: z
      .object({
        ref: z.string().min(1),
        repo: z.object({ full_name: z.string().min(1) }).passthrough(),
      })
      .passthrough(),
    head: z
      .object({
        sha: z.string().min(1),
        repo: z
          .object({ full_name: z.string().min(1) })
          .passthrough()
          .nullable(),
      })
      .passthrough(),
    labels: z.array(z.object({ name: z.string() }).passthrough()),
  })
  .passthrough();

const reviewSchema = z
  .object({
    id: z.number().int().positive(),
    user: userSchema.nullable(),
    state: z.string(),
    html_url: z.string().url(),
    submitted_at: z.string().datetime().nullable(),
    commit_id: z.string(),
  })
  .passthrough();

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class GithubRestClient implements GithubApprovalSource {
  constructor(
    private readonly token: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "checkpoint-github-approval-adapter",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async getPullRequest(
    repository: string,
    pullNumber: number,
  ): Promise<GithubPullRequest> {
    return pullRequestSchema.parse(
      await this.get(`/repos/${repository}/pulls/${pullNumber}`),
    ) as GithubPullRequest;
  }

  async listPullRequestReviews(
    repository: string,
    pullNumber: number,
  ): Promise<GithubReview[]> {
    const reviews: GithubReview[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = z
        .array(reviewSchema)
        .parse(
          await this.get(
            `/repos/${repository}/pulls/${pullNumber}/reviews?per_page=100&page=${page}`,
          ),
        );
      reviews.push(...(batch as GithubReview[]));
      if (batch.length < 100) return reviews;
    }
    throw new Error("GitHub review limit exceeded (1000)");
  }
}
