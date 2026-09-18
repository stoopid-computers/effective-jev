import assert from "node:assert/strict";
import { parse } from "@babel/parser";

// JSR uploads explicit registry specifiers, not the import-map aliases in the checkout.
export function jsrImports(source, imports) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
    createImportExpressions: true,
  });
  const changes = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const specifier = [
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
      "ImportExpression",
    ].includes(node.type)
      ? node.source
      : node.type === "TSImportType"
        ? node.argument
        : undefined;
    if (specifier) {
      assert.equal(specifier.type, "StringLiteral", "JSR imports must use literal module names.");
      const name = specifier.value;
      if (imports[name])
        changes.push({ start: specifier.start + 1, end: specifier.end - 1, text: imports[name] });
      else
        assert.ok(
          name.startsWith("./") || name.startsWith("../") || /^(npm|jsr|node):/.test(name),
          `Missing JSR import mapping: ${name}`,
        );
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, change.start) + change.text + source.slice(change.end);
  }
  return source;
}
