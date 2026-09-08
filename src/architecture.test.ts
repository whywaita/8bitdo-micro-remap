import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
it("keeps protocol modules independent from browser, UI, storage and Worker", () => {
  for (const name of readdirSync(
    new URL("./protocol/", import.meta.url),
  ).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const source = readFileSync(
      new URL(`./protocol/${name}`, import.meta.url),
      "utf8",
    );
    const file = ts.createSourceFile(
      name,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of file.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
        expect(statement.moduleSpecifier.text.startsWith("./")).toBe(true);
    expect(source).not.toMatch(
      /\b(navigator|document|window|indexedDB|fetch)\b/,
    );
  }
});
