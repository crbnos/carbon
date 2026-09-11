import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "../app");
const allowedExtensions = new Set([".ts", ".tsx"]);
const excludedSegments = [
  ".server.",
  ".test.",
  ".spec.",
  `${path.sep}locales${path.sep}`
];

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (!allowedExtensions.has(path.extname(fullPath))) {
      continue;
    }

    if (excludedSegments.some((segment) => fullPath.includes(segment))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function relative(filePath: string): string {
  return path.relative(path.resolve(__dirname, ".."), filePath);
}

// These assertions mirror `.claude/rules/i18n-lingui-system.md`. Keep them in
// step with it — this file previously banned the `@lingui/core/macro` MODULE
// outright, which flagged 284 files for importing `msg`, the very pattern that
// rule prescribes for route breadcrumbs. A gate that contradicts the documented
// convention cannot be satisfied, so it was never run and rotted for months.
// What the rule actually prohibits is narrower, and is what is checked here.
describe("Lingui React macro migration", () => {
  it("never imports the non-contextual `t` from @lingui/core/macro", () => {
    // No `runtimeConfigModule` is configured, so this `t` would resolve against
    // a global i18n instance rather than the request's.
    const offenders = collectFiles(appRoot).filter((filePath) =>
      /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"]@lingui\/core\/macro['"]/.test(
        readFileSync(filePath, "utf8")
      )
    );

    expect(offenders.map(relative)).toEqual([]);
  });

  it("does not unwrap a literal `msg` at runtime instead of using `t`", () => {
    // `i18n._(msg`Scrap`)` is the long way round to `t`Scrap``. Rendering a
    // descriptor built ELSEWHERE — `i18n._(someDescriptor)` from a lookup map —
    // is legitimate and deliberately not matched here.
    const offenders = collectFiles(appRoot).filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /[._]\(\s*msg`/.test(source) || source.includes("t(msg(");
    });

    expect(offenders.map(relative)).toEqual([]);
  });
});
