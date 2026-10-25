import { afterEach, expect, test } from "bun:test";
import { govSearchArgs, govSearchRequest, govSearchResult } from "./firecrawl-gov.js";
import { webInputSchema, webRequest, webResult } from "./web.js";

const previousKey = process.env.FIRECRAWL_API_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = previousKey;
});
const input = () => {
  const value = webInputSchema.parse({ kind: "gov", query: "California noncompete agreements", jurisdiction: "us-ca", sessionID: "private-chat", agent: "legalwork" });
  if (value.kind !== "gov") throw new Error("Expected a Government Index search fixture.");
  return value;
};
const response = (payload: unknown, status = 200) => ({ status, headers: {}, bodyBase64: Buffer.from(JSON.stringify(payload)).toString("base64") });
const hit = { url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=16600", title: "California Code, BPC 16600", description: "Source passage" };

test("keyless requests forward only documented search fields, including every filter", () => {
  delete process.env.FIRECRAWL_API_KEY;
  const args = { ...input(), court: "ca9", courtType: "federal-appellate", cites: "42 U.S.C. § 1983", domain: "ca9.uscourts.gov", k: 3 };
  const request = webRequest(webInputSchema.parse(args));
  expect(request.url).toBe("https://api.firecrawl.dev/v2/search/gov");
  expect(request.method).toBe("POST");
  expect(request.headers.authorization).toBeUndefined();
  expect(JSON.parse(Buffer.from(request.bodyBase64, "base64").toString())).toEqual({
    query: args.query, jurisdiction: args.jurisdiction, court: args.court, courtType: args.courtType, cites: args.cites, domain: args.domain, k: 3,
  });
  expect(Buffer.from(request.bodyBase64, "base64").toString()).not.toContain("private-chat");
});

test("an optional key is sent only as a bearer header to the fixed endpoint", () => {
  process.env.FIRECRAWL_API_KEY = "  fc-test-secret  ";
  const request = govSearchRequest(govSearchArgs.parse({ query: "42 USC 1983" }));
  expect(request.headers.authorization).toBe("Bearer fc-test-secret");
  expect(request.url).not.toContain("fc-test-secret");
  expect(Buffer.from(request.bodyBase64, "base64").toString()).not.toContain("fc-test-secret");
});

test("invalid queries, filters, extra fields and result limits fail before networking", () => {
  for (const patch of [{ query: "   " }, { query: "x".repeat(2001) }, { k: 0 }, { k: 21 }, { k: 1.5 },
    { jurisdiction: "de" }, { courtType: "invented" }, { domain: "https://irs.gov/path" }, { url: "https://other.example/" }, { apiKey: "secret" }]) {
    expect(webInputSchema.safeParse({ ...input(), ...patch }).success).toBe(false);
  }
});

test("results preserve source identity, applied filters and bounded excerpts", async () => {
  const result = await webResult(input(), "https://api.firecrawl.dev/v2/search/gov", response({ success: true, data: { web: [{ ...hit, description: "x".repeat(5000), cites: ["unverified"] }] } }));
  const output = JSON.parse(result.output);
  expect(output.results).toEqual([{ url: hit.url, title: hit.title, excerpt: "x".repeat(4000), excerptTruncated: true }]);
  expect(output.filters).toEqual({ jurisdiction: "us-ca" });
  expect(output.notice).toContain("historical versions");
  expect(output.notice).toContain("untrusted source excerpts");
  expect(output.notice).toContain("legalwork_webfetch");
  expect(result.metadata).toEqual({ provider: "firecrawl", index: "gov", numResults: 1 });
});

test("empty success is distinguished from provider failure and does not imply no law", () => {
  const output = JSON.parse(govSearchResult(input(), response({ success: true, data: { web: [] } })).output);
  expect(output.results).toEqual([]);
  expect(output.notice).toContain("No results does not mean no applicable law");
  for (const payload of [{ success: false, error: "provider secret" }, {}, { success: true, data: {} }, { success: true, data: { web: [{ ...hit, url: "javascript:alert(1)" }] } }]) {
    expect(() => govSearchResult(input(), response(payload))).toThrow("invalid Government Index response");
  }
  expect(() => govSearchResult(input(), { status: 200, headers: {}, bodyBase64: Buffer.from("not JSON").toString("base64") })).toThrow("unreadable");
});

test("provider errors are actionable and never echo provider bodies or credentials", () => {
  for (const [status, message] of [[400, "Check the query"], [401, "Check the optional"], [403, "Check the optional"], [429, "rate limit"], [503, "unavailable"]] satisfies Array<[number, string]>) {
    expect(() => govSearchResult(input(), response({ error: "fc-secret" }, status))).toThrow(message);
    try { govSearchResult(input(), response({ error: "fc-secret" }, status)); }
    catch (error) { expect(String(error)).not.toContain("fc-secret"); }
  }
});

test("a provider returning too many hits cannot exceed the requested limit", () => {
  const args = govSearchArgs.parse({ query: "statute", k: 1 });
  expect(JSON.parse(govSearchResult(args, response({ success: true, data: { web: [hit, hit] } })).output).results).toHaveLength(1);
});
