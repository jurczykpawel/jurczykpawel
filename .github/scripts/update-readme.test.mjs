import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnProject, renderProjects, replaceSection, computeStats, renderStats, pingUrl, checkLiveStatus, renderLive, isExternalPR, renderContributions, fetchContributions } from "./update-readme.mjs";

test("isOwnProject excludes forks, archived, private, and the curated exclude list", () => {
  assert.equal(isOwnProject({ name: "sellf", fork: false, archived: false, private: false }), true);
  assert.equal(isOwnProject({ name: "sellf", fork: true, archived: false, private: false }), false);
  assert.equal(isOwnProject({ name: "sellf", fork: false, archived: true, private: false }), false);
  assert.equal(isOwnProject({ name: "sellf", fork: false, archived: false, private: true }), false);
  assert.equal(isOwnProject({ name: "jurczykpawel", fork: false, archived: false, private: false }), false);
  assert.equal(isOwnProject({ name: "PAVVEL11", fork: false, archived: false, private: false }), false);
});

test("renderProjects sorts by stars descending, then name, and renders each card", () => {
  const repos = [
    { name: "b-repo", fork: false, archived: false, private: false, language: "Python", stargazers_count: 1, html_url: "https://github.com/jurczykpawel/b-repo", description: "B repo" },
    { name: "a-repo", fork: false, archived: false, private: false, language: "TypeScript", stargazers_count: 5, html_url: "https://github.com/jurczykpawel/a-repo", description: "A repo" },
  ];

  const { count, body } = renderProjects(repos);

  assert.equal(count, 2);
  assert.ok(body.indexOf("a-repo") < body.indexOf("b-repo"), "higher-starred repo should render first");
  assert.match(body, /⭐ 5/);
});

test("replaceSection replaces content between named HTML-comment markers", () => {
  const content = "before\n<!-- FOO:START -->\nold\n<!-- FOO:END -->\nafter";
  const result = replaceSection(content, "FOO", "new");
  assert.equal(result, "before\n<!-- FOO:START -->\nnew\n<!-- FOO:END -->\nafter");
});

test("replaceSection throws when markers are missing", () => {
  assert.throws(() => replaceSection("no markers here", "FOO", "new"));
});

test("computeStats sums stars and counts languages across own projects only", () => {
  const repos = [
    { name: "a", fork: false, archived: false, private: false, language: "TypeScript", stargazers_count: 3 },
    { name: "b", fork: false, archived: false, private: false, language: "TypeScript", stargazers_count: 2 },
    { name: "c", fork: false, archived: false, private: false, language: "Python", stargazers_count: 1 },
    { name: "d", fork: true, archived: false, private: false, language: "Python", stargazers_count: 100 },
    { name: "e", fork: false, archived: false, private: false, language: null, stargazers_count: 0 },
  ];

  const stats = computeStats(repos);

  assert.equal(stats.count, 4);
  assert.equal(stats.totalStars, 6);
  assert.deepEqual(stats.languages, ["TypeScript", "Python"]);
});

test("renderStats formats the count, star total, and language list", () => {
  const line = renderStats({ count: 10, totalStars: 6, languages: ["TypeScript", "Python"] });
  assert.equal(
    line,
    "**10** public projects &nbsp;·&nbsp; **⭐ 6** total stars &nbsp;·&nbsp; TypeScript · Python"
  );
});

test("renderStats omits the language segment when there are no languages", () => {
  const line = renderStats({ count: 0, totalStars: 0, languages: [] });
  assert.equal(line, "**0** public projects &nbsp;·&nbsp; **⭐ 0** total stars");
});

test("pingUrl returns true when HEAD succeeds", async () => {
  const fetchImpl = async (_url, opts) => {
    assert.equal(opts.method, "HEAD");
    return { ok: true, status: 200 };
  };
  assert.equal(await pingUrl("https://example.com", fetchImpl), true);
});

test("pingUrl falls back to GET when HEAD returns an error status", async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => {
    calls.push(opts.method);
    if (opts.method === "HEAD") return { ok: false, status: 405 };
    return { ok: true, status: 200 };
  };
  assert.equal(await pingUrl("https://example.com", fetchImpl), true);
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("pingUrl returns false when both HEAD and GET fail", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  assert.equal(await pingUrl("https://example.com", fetchImpl), false);
});

test("pingUrl returns false when fetch throws (network error or timeout)", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  assert.equal(await pingUrl("https://example.com", fetchImpl), false);
});

test("checkLiveStatus checks each product and preserves name/url", async () => {
  const products = [
    { name: "Up Site", url: "https://up.example.com" },
    { name: "Down Site", url: "https://down.example.com" },
  ];
  const fetchImpl = async (url) => ({ ok: url.includes("up."), status: url.includes("up.") ? 200 : 500 });

  const results = await checkLiveStatus(products, fetchImpl);

  assert.deepEqual(results, [
    { name: "Up Site", url: "https://up.example.com", ok: true },
    { name: "Down Site", url: "https://down.example.com", ok: false },
  ]);
});

test("renderLive renders a checkmark line per product", () => {
  const line = renderLive([
    { name: "Up Site", url: "https://up.example.com", ok: true },
    { name: "Down Site", url: "https://down.example.com", ok: false },
  ]);
  assert.equal(line, "✅ [Up Site](https://up.example.com)\n⚠️ [Down Site](https://down.example.com)");
});

test("isExternalPR is true for repos not owned by the profile user", () => {
  assert.equal(isExternalPR({ repository_url: "https://api.github.com/repos/someone-else/their-repo" }), true);
  assert.equal(isExternalPR({ repository_url: "https://api.github.com/repos/jurczykpawel/sellf" }), false);
});

test("renderContributions renders up to 6 items, newest merge first, with a heading", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    title: `Fix ${i}`,
    html_url: `https://github.com/owner/repo/pull/${i}`,
    repository_url: "https://api.github.com/repos/owner/repo",
    pull_request: { merged_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` },
    closed_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));

  const body = renderContributions(items);
  const lines = body.split("\n").filter(Boolean);

  assert.match(lines[0], /^## Contributions Elsewhere$/);
  assert.equal(lines.length - 1, 6);
  assert.match(lines[1], /Fix 7/);
  assert.match(lines[1], /merged 2026-01-08/);
});

test("renderContributions excludes PRs in the user's own repos", () => {
  const items = [
    {
      title: "Own repo PR",
      html_url: "https://github.com/jurczykpawel/sellf/pull/1",
      repository_url: "https://api.github.com/repos/jurczykpawel/sellf",
      pull_request: { merged_at: "2026-01-01T00:00:00Z" },
      closed_at: "2026-01-01T00:00:00Z",
    },
    {
      title: "External PR",
      html_url: "https://github.com/owner/repo/pull/2",
      repository_url: "https://api.github.com/repos/owner/repo",
      pull_request: { merged_at: "2026-01-02T00:00:00Z" },
      closed_at: "2026-01-02T00:00:00Z",
    },
  ];

  const body = renderContributions(items);

  assert.doesNotMatch(body, /Own repo PR/);
  assert.match(body, /External PR/);
});

test("renderContributions returns an empty string when there are no external merged PRs", () => {
  assert.equal(renderContributions([]), "");
});

test("fetchContributions queries the search API for merged PRs by the profile user", async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /search\/issues\?q=/);
    assert.match(url, /author%3Ajurczykpawel/);
    assert.match(url, /type%3Apr/);
    assert.match(url, /is%3Amerged/);
    assert.match(url, /per_page=100/);
    assert.match(url, /sort=updated/);
    return { ok: true, json: async () => ({ items: [{ title: "x" }] }) };
  };

  const items = await fetchContributions(fetchImpl);

  assert.deepEqual(items, [{ title: "x" }]);
});

test("fetchContributions throws when the search API responds with an error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "rate limited" });
  await assert.rejects(() => fetchContributions(fetchImpl));
});
