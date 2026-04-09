import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "../app");
const repoRoot = path.resolve(__dirname, "..");
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

const migrationReviewFiles = [
  "app/components/Layout/Topbar/Notifications.tsx",
  "app/root.tsx",
  "app/routes/_public+/callback.tsx",
  "app/routes/_public+/invite.$code.tsx",
  "app/routes/_public+/login.tsx",
  "app/routes/_public+/verify.tsx",
  "app/routes/x+/account+/profile.tsx"
].map((relativePath) => path.resolve(repoRoot, relativePath));
const migrationReviewFileSet = new Set(migrationReviewFiles);

describe("Lingui React macro migration", () => {
  it("avoids msg-based translations in React-facing app files", () => {
    const offenders: string[] = [];

    for (const filePath of collectFiles(appRoot)) {
      const source = readFileSync(filePath, "utf8");
      const relativePath = path.relative(path.resolve(__dirname, ".."), filePath);

      if (
        !migrationReviewFileSet.has(filePath) &&
        (source.includes('@lingui/core/macro') ||
          source.includes("from '@lingui/core/macro'") ||
          source.includes("_(msg") ||
          source.includes("t(msg("))
      ) {
        offenders.push(relativePath);
      }

      if (
        source.includes("useLingui") &&
        (source.includes('from "@lingui/react"') ||
          source.includes("from '@lingui/react'"))
      ) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("avoids descriptor-object translations in reviewed migration files", () => {
    const offenders: string[] = [];

    for (const filePath of migrationReviewFiles) {
      const source = readFileSync(filePath, "utf8");
      const relativePath = path.relative(repoRoot, filePath);

      if (/t\(\{\s*id:/m.test(source) || /i18n\._\(\{\s*id:/m.test(source)) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("uses request-scoped i18n helpers in reviewed server files", () => {
    const offenders: string[] = [];

    for (const filePath of migrationReviewFiles) {
      const source = readFileSync(filePath, "utf8");
      const relativePath = path.relative(repoRoot, filePath);
      const importsCoreMacro =
        source.includes('from "@lingui/core/macro"') ||
        source.includes("from '@lingui/core/macro'");

      if (importsCoreMacro && !source.includes("getRequestI18n")) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
