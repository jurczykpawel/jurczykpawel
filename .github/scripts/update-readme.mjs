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

export function replaceSection(content, name, replacement) {
  const re = new RegExp(`(<!-- ${name}:START -->)([\\s\\S]*?)(<!-- ${name}:END -->)`);
  if (!re.test(content)) throw new Error(`Markers for ${name} not found in README`);
  return content.replace(re, `$1\n${replacement}\n$3`);
}

export async function main() {
  const repos = await fetchAllRepos();
  const { count, body } = renderProjects(repos);
  const stats = computeStats(repos);

  let readme = await readFile(README, "utf8");
  readme = replaceSection(readme, "PROJECTS", body);
  readme = replaceSection(readme, "COUNT", renderStats(stats));
  await writeFile(README, readme);

  console.log(`Updated README: ${count} projects.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
