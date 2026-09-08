import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
test("production assets exclude fake device hooks and source maps", () => {
  const files = readdirSync(root, { recursive: true }).filter((file) =>
    /\.(js|html|map)$/.test(file),
  );
  assert.ok(files.some((file) => file.endsWith(".js")));
  for (const file of files) {
    assert.ok(!file.endsWith(".map"));
    const content = readFileSync(join(root, file), "utf8");
    for (const marker of [
      "__microTests",
      "fake-device",
      "scripted write failure",
      "createBrowserTestRuntime",
    ])
      assert.ok(
        !content.includes(marker),
        `${file} contains test-only marker ${marker}`,
      );
  }
});
