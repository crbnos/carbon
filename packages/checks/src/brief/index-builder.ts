// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_SETS, type FileSet } from "./file-sets";
import { parseLessonFile } from "./lessons";
import { parseFrontmatter, readScope, type Trigger } from "./scope";

export type RuleEntry = {
  id: string;
  title: string;
  paths: string[];
  triggers: Trigger[];
  summary: string[];
};

export type LessonEntry = {
  id: string;
  title: string;
  paths: string[];
  triggers: Trigger[];
  rule: string;
};

export type CheckEntry = {
  id: string;
  set: FileSet["name"];
  description: string;
  replacedBy: string;
  triggers: Trigger[];
};

/** Every rule, lesson and single-file check with its scope. */
export type BriefIndex = {
  rules: RuleEntry[];
  lessons: LessonEntry[];
  checks: CheckEntry[];
};

const RULES_DIR = ".claude/rules";
const LESSONS_DIR = ".ai/lessons";

function firstHeading(body: string): string {
  const line = body.split("\n").find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : "";
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
}

function readSummary(value: unknown, file: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${file}: summary must be a list of strings`);
  }
  return value as string[];
}

export function buildBriefIndex(root: string): BriefIndex {
  const rules = markdownFiles(join(root, RULES_DIR)).map((name) => {
    const id = `${RULES_DIR}/${name}`;
    const { data, body } = parseFrontmatter(
      readFileSync(join(root, id), "utf8")
    );
    return {
      id,
      title: firstHeading(body),
      ...readScope(data),
      summary: readSummary(data.summary, id)
    };
  });

  const lessons = markdownFiles(join(root, LESSONS_DIR)).flatMap((name) => {
    const file = `${LESSONS_DIR}/${name}`;
    const { body } = parseFrontmatter(readFileSync(join(root, file), "utf8"));
    return parseLessonFile(body, file).map((lesson) => ({
      id: `${file}#${lesson.id}`,
      title: lesson.title,
      paths: lesson.paths,
      triggers: lesson.triggers,
      rule: lesson.rule
    }));
  });

  const checks = FILE_SETS.flatMap((set) =>
    set.checks(root).map((check) => ({
      id: check.id,
      set: set.name,
      description: check.description,
      replacedBy: check.provenance.replacedBy,
      triggers: check.triggers
    }))
  );

  return { rules, lessons, checks };
}
