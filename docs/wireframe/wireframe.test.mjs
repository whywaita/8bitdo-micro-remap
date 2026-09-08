import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
test("all documented errors have a reachable screen", () => {
  const index = readFileSync(join(root, "index.html"), "utf8");
  const impl = readFileSync(join(root, "../impl.md"), "utf8");
  const codes = impl
    .split("## 14. Error taxonomy")[1]
    .match(/```text\n([\s\S]*?)```/)[1]
    .trim()
    .split("\n");
  for (const code of codes) assert.ok(index.includes(code), code);
});
test("static screens are offline, linked, titled and uniquely identified", () => {
  const files = readdirSync(root).filter((f) => f.endsWith(".html"));
  assert.ok(
    files.length >= 35,
    "include normal, intermediate, error and recovery screens",
  );
  const index = readFileSync(join(root, "index.html"), "utf8");
  for (const file of files) {
    const html = readFileSync(join(root, file), "utf8");
    assert.match(html, /lang="ja"/);
    assert.match(html, /name="viewport"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, file);
    assert.doesNotMatch(
      html,
      /<(script|iframe)|(?:src|href)="https?:\/\/(?!support\.8bitdo\.com)/,
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, file);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (!href.startsWith("https:"))
        assert.ok(existsSync(join(root, href)), `${file}: ${href}`);
    }
    if (file !== "index.html") assert.ok(index.includes(file), file);
  }
});
test("restore confirmation preserves unknown fields and requires review", () => {
  const html = readFileSync(join(root, "restore-confirm.html"), "utf8");
  assert.match(html, /現在の未知の設定を保持/);
  assert.match(html, /スキップ/);
  assert.match(html, /復元を確定/);
  assert.match(html, /キャンセル/);
});
