// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const INTEGRATION_HAS_RULE = "integration-has-rule";

export const INTEGRATIONS_DIR = "packages/ee/src";
export const INTEGRATION_REGISTRY_FILE = `${INTEGRATIONS_DIR}/index.ts`;
export const RULES_DIR = ".claude/rules";

/** A descriptor file: `config.tsx` or `config-<variant>.tsx`. */
export const INTEGRATION_CONFIG_FILE = /^config(?:-[\w-]+)?\.tsx$/;

/** One directory directly under `packages/ee/src/` that holds a descriptor file. */
export type IntegrationDir = {
  /** The directory name, e.g. "jira". */
  name: string;
  /** Its `config.tsx` / `config-*.tsx` files, repo-relative. */
  configs: SourceFile[];
  /** Every file under the directory, repo-relative. */
  files: string[];
};

export type IntegrationRuleSources = {
  integrations: IntegrationDir[];
  /** `packages/ee/src/index.ts`, whose `integrations` array registers each descriptor. */
  registry: SourceFile;
  /** `.claude/rules/*.md`. */
  rules: SourceFile[];
};

type Definition = { name?: string; active: boolean; line: number };

const DEFINE_CALL =
  /(?:export\s+const\s+(\w+)\s*=\s*)?\bdefine(?:Piece)?Integration\s*\(/g;

/** Index just past the closing quote/backtick of the string that opens at `i`. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote) j += text[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Index just past the comment that opens at `i`, or `i` if none opens there. */
function skipComment(text: string, i: number): number {
  if (text.startsWith("//", i)) {
    const end = text.indexOf("\n", i);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith("/*", i)) {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}

/**
 * The value text of the top-level `active:` key of the object literal passed
 * to the call whose `(` is at `open`, or undefined when there is none.
 */
function activeValue(text: string, open: number): string | undefined {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skipped = skipComment(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return undefined;
    }
    // Depth 2: inside the call's parentheses and its object literal.
    if (depth === 2 && /^\bactive\s*:/.test(text.slice(i, i + 32))) {
      const prev = text[i - 1] ?? "";
      if (!/[\w$.]/.test(prev)) {
        const rest = text.slice(i).replace(/^active\s*:\s*/, "");
        return /^[^,\n}]*/.exec(rest)?.[0]?.trim();
      }
    }
    i += 1;
  }
  return undefined;
}

/** Every `defineIntegration(…)` / `definePieceIntegration(…)` call in a descriptor file. */
function definitions(contents: string): Definition[] {
  return [...contents.matchAll(DEFINE_CALL)].map((m) => {
    const index = m.index ?? 0;
    return {
      name: m[1],
      active: activeValue(contents, index + m[0].length - 1) !== "false",
      line: contents.slice(0, index).split("\n").length
    };
  });
}

/**
 * The names listed in `export const integrations = [ … ]`, comments removed.
 * Undefined when the array is not found, so every definition then counts as
 * registered: a moved registry yields more findings, never fewer.
 */
function registeredNames(registry: SourceFile): Set<string> | undefined {
  const body = /export\s+const\s+integrations\s*=\s*\[([^\]]*)\]/.exec(
    registry.contents
  )?.[1];
  if (body === undefined) return undefined;
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

const unquote = (value: string) => {
  const v = value.trim();
  const quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(v);
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  // An unquoted YAML scalar ends at a ` #` comment.
  return v.replace(/\s+#.*$/, "");
};

/** The globs in a rule file's `paths:` frontmatter (block list, inline array or one scalar). */
export function ruleGlobs(contents: string): string[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const at = lines.findIndex((l) => /^paths\s*:/.test(l));
  if (at === -1) return [];
  const inline = (lines[at] ?? "").replace(/^paths\s*:\s*/, "").trim();
  if (inline.startsWith("[")) {
    const items = inline.replace(/^\[/, "").replace(/\].*$/, "");
    return [...items.matchAll(/"([^"]*)"|'([^']*)'|([^,\s][^,]*)/g)]
      .map((m) => m[1] ?? m[2] ?? unquote(m[3] ?? ""))
      .filter(Boolean);
  }
  if (inline) return [unquote(inline)];
  const globs: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "") continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (!item) break;
    globs.push(unquote(item[1] ?? ""));
  }
  return globs.filter(Boolean);
}

function globToRegex(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? "";
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") out += "(?:";
    else if (c === "}") out += ")";
    else if (c === ",") out += "|";
    else out += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * True when a glob names `dir` (it starts with `packages/ee/src/<dir>/`, or is
 * that directory) and matches at least one file in it. A glob that only
 * reaches the directory through a wildcard (`packages/**`) does not count: it
 * would cover every integration, including the next one.
 */
function globCovers(glob: string, dir: IntegrationDir): boolean {
  const base = `${INTEGRATIONS_DIR}/${dir.name}`;
  let g = glob.replace(/^\.\//, "");
  if (g === base || g.endsWith("/")) g = `${g.replace(/\/$/, "")}/**`;
  if (!g.startsWith(`${base}/`)) return false;
  const re = globToRegex(g);
  return dir.files.some((file) => re.test(file));
}

/**
 * Every active, registered integration under `packages/ee/src/<dir>/` needs a
 * developer guide that loads when someone edits it: a `.claude/rules/*.md`
 * whose `paths:` frontmatter names the directory, or its own `AGENTS.md`.
 * Without one, the next agent to touch the integration starts from nothing.
 *
 * A directory is skipped when none of its `define(Piece)?Integration` calls
 * is both registered (listed in the `integrations` array of
 * `packages/ee/src/index.ts`) and active (`active` is anything but a literal
 * `false`: an env expression counts as active).
 */
export function findIntegrationsWithoutRule({
  integrations,
  registry,
  rules
}: IntegrationRuleSources): Violation[] {
  const registered = registeredNames(registry);
  const globs = rules.flatMap((rule) => ruleGlobs(rule.contents));
  const out: Violation[] = [];
  for (const dir of integrations) {
    const live = dir.configs.flatMap((config) =>
      definitions(config.contents)
        .filter(
          (d) =>
            d.active &&
            (!registered || d.name === undefined || registered.has(d.name))
        )
        .map((d) => ({ ...d, file: config.file }))
    );
    const first = live[0];
    if (!first) continue;
    const path = `${INTEGRATIONS_DIR}/${dir.name}`;
    if (dir.files.includes(`${path}/AGENTS.md`)) continue;
    if (globs.some((glob) => globCovers(glob, dir))) continue;
    out.push({
      file: first.file,
      line: first.line,
      snippet: path,
      message: `\`${path}\` is a registered integration with no rule. Add \`${RULES_DIR}/${dir.name}-integration.md\` with a \`paths:\` glob for it, or a \`${path}/AGENTS.md\`.`
    });
  }
  return out;
}
