import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnProject, renderProjects, replaceSection } from "./update-readme.mjs";

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
