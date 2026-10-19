import { ApiError } from "./errors.js";

export type ClaudePluginSource = {
  owner: string;
  repo: string;
  ref: string | null;
  dir: string | null;
  /**
   * Raw path segments after `/tree/` when present. Branch names may contain
   * slashes (e.g. `release/v1`), so the ref/dir split is ambiguous from the
   * URL alone — the resolver tries candidates against the trees API.
   */
  treeSegments: string[] | null;
};

// GitHub owners are alphanumeric + hyphen; repos additionally allow dots and underscores.
const GITHUB_OWNER_RE = /^[A-Za-z0-9-]+$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Accepts `https://github.com/owner/repo`, `github.com/owner/repo`,
 * `owner/repo`, with optional `.git` suffix and `/tree/<ref>(/<subdir>)`.
 */
export function parseClaudePluginSource(input: string): ClaudePluginSource {
  // Drop query strings and hash fragments (e.g. ?tab=readme-ov-file).
  const trimmed = (input.split(/[?#]/)[0] ?? "").trim();
  if (!trimmed) throw new ApiError(400, "invalid_plugin_url", "GitHub URL is required");
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const hadHost = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\//.test(withoutProtocol);
  if (hadHost && !withoutProtocol.startsWith("github.com/")) {
    throw new ApiError(400, "invalid_plugin_url", "Only github.com sources are supported");
  }
  const path = hadHost ? withoutProtocol.slice(withoutProtocol.indexOf("/") + 1) : withoutProtocol;
  const parts = path.split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/, "");
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) {
    throw new ApiError(400, "invalid_plugin_url", "Expected a GitHub repo URL like https://github.com/owner/repo");
  }
  let ref: string | null = null;
  let dir: string | null = null;
  let treeSegments: string[] | null = null;
  if (parts[2] === "tree" && parts[3]) {
    treeSegments = parts.slice(3);
    ref = parts[3] ?? null;
    const rest = parts.slice(4);
    if (rest.length > 0) dir = rest.join("/");
  }
  return { owner, repo, ref, dir, treeSegments };
}
