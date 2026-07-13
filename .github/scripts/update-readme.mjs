#!/usr/bin/env node
// Regenerates the auto-updating sections of README.md from GitHub's public API.
// Zero dependencies — uses native fetch (Node 20+). Runs in CI on a schedule.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const USER = "jurczykpawel";
const README = new URL("../../README.md", import.meta.url);

// Repos we never want to surface (profile repo, link-in-bio, throwaways).
const EXCLUDE = new Set(["jurczykpawel", "pavvel11", "littlelink"]);

// Curated taglines override the GitHub description when present (nicer copy).
const TAGLINES = {
  sellf: "Self-hosted platform for selling digital products. Stripe payments, sales funnels, 0% platform fees.",
  "mikrus-toolbox": "25+ self-hosted apps, one server, zero subscriptions. Deploy with a single command.",
};

const LANG_EMOJI = {
  TypeScript: "🟦", JavaScript: "🟨", Python: "🐍", Shell: "🐚",
  PHP: "🐘", "C#": "🎯", HTML: "🌐", Go: "🐹", Rust: "🦀", Ruby: "💎",
};

// Live self-hosted products to show as proof the "self-host everything" pitch is real.
const LIVE_PRODUCTS = [
  { name: "TechSkills Academy", url: "https://techskills.academy" },
  { name: "Sellf", url: "https://sellf.techskills.academy" },
  { name: "PostStack", url: "https://poststack.techskills.academy" },
];

const LIVE_CHECK_TIMEOUT_MS = 5000;
const CONTRIBUTIONS_LIMIT = 6;

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function fetchAllRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/users/${USER}/repos?per_page=100&page=${page}&sort=pushed`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

export function isOwnProject(r) {
  return !r.fork && !r.archived && !r.private && !EXCLUDE.has(r.name.toLowerCase());
}

export function renderProjects(repos) {
  const sorted = repos
    .filter(isOwnProject)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || a.name.localeCompare(b.name));

  const lines = sorted.map((r) => {
    const emoji = LANG_EMOJI[r.language] || "📦";
    const desc = TAGLINES[r.name.toLowerCase()] || r.description || "—";
    const meta = [
      r.language && `${emoji} ${r.language}`,
      r.stargazers_count > 0 && `⭐ ${r.stargazers_count}`,
    ].filter(Boolean).join(" &nbsp;·&nbsp; ");
    return `### [${r.name}](${r.html_url})\n${desc}${meta ? `\n\n<sub>${meta}</sub>` : ""}`;
  });

  return { count: sorted.length, body: lines.join("\n\n") };
}

export function computeStats(repos) {
  const owned = repos.filter(isOwnProject);
  const totalStars = owned.reduce((sum, r) => sum + r.stargazers_count, 0);

  const langCounts = new Map();
  for (const r of owned) {
    if (!r.language) continue;
    langCounts.set(r.language, (langCounts.get(r.language) || 0) + 1);
  }
  const languages = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lang]) => lang);

  return { count: owned.length, totalStars, languages };
}

export function renderStats({ count, totalStars, languages }) {
  const parts = [`**${count}** public projects`, `**⭐ ${totalStars}** total stars`];
  if (languages.length) parts.push(languages.join(" · "));
  return parts.join(" &nbsp;·&nbsp; ");
}

async function attempt(url, method, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { method, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function pingUrl(url, fetchImpl = fetch) {
  try {
    const headRes = await attempt(url, "HEAD", fetchImpl);
    if (headRes.ok) return true;
  } catch {
    // HEAD failed outright — fall through and try GET.
  }

  try {
    const getRes = await attempt(url, "GET", fetchImpl);
    return getRes.ok;
  } catch {
    return false;
  }
}

export async function checkLiveStatus(products, fetchImpl = fetch) {
  const results = [];
  for (const product of products) {
    const ok = await pingUrl(product.url, fetchImpl);
    results.push({ ...product, ok });
  }
  return results;
}

export function renderLive(results) {
  return results.map((r) => `${r.ok ? "✅" : "⚠️"} [${r.name}](${r.url})`).join("\n");
}

export async function fetchContributions(fetchImpl = fetch) {
  const q = encodeURIComponent(`author:${USER} type:pr is:merged`);
  const res = await fetchImpl(
    `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=20`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub search API ${res.status}: ${await res.text()}`);
  const { items } = await res.json();
  return items;
}

export function isExternalPR(item) {
  return !item.repository_url.startsWith(`https://api.github.com/repos/${USER}/`);
}

export function renderContributions(items) {
  const external = items
    .filter(isExternalPR)
    .map((item) => ({
      title: item.title,
      url: item.html_url,
      repoFullName: item.repository_url.replace("https://api.github.com/repos/", ""),
      mergedAt: item.pull_request?.merged_at || item.closed_at,
    }))
    .sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt))
    .slice(0, CONTRIBUTIONS_LIMIT);

  if (external.length === 0) return "";

  const lines = external.map(({ title, url, repoFullName, mergedAt }) => {
    const repoUrl = `https://github.com/${repoFullName}`;
    const mergedDate = mergedAt ? mergedAt.slice(0, 10) : "";
    return `- **[${title}](${url})** in [${repoFullName}](${repoUrl})${mergedDate ? ` — merged ${mergedDate}` : ""}`;
  });

  return `## Contributions Elsewhere\n\n${lines.join("\n")}`;
}

export function replaceSection(content, name, replacement) {
  const re = new RegExp(`(<!-- ${name}:START -->)([\\s\\S]*?)(<!-- ${name}:END -->)`);
  if (!re.test(content)) throw new Error(`Markers for ${name} not found in README`);
  return content.replace(re, `$1\n${replacement}\n$3`);
}

export async function main() {
  const repos = await fetchAllRepos();
  const { count, body } = renderProjects(repos);
  const stats = computeStats(repos);
  const liveResults = await checkLiveStatus(LIVE_PRODUCTS);
  const contributions = await fetchContributions();

  let readme = await readFile(README, "utf8");
  readme = replaceSection(readme, "PROJECTS", body);
  readme = replaceSection(readme, "COUNT", renderStats(stats));
  readme = replaceSection(readme, "LIVE", renderLive(liveResults));
  readme = replaceSection(readme, "CONTRIB", renderContributions(contributions));
  await writeFile(README, readme);

  console.log(`Updated README: ${count} projects.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
