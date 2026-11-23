// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type EnvName, type EnvVar, FEATURES, resolve, schema } from "./schema";

type Problem = {
  /** Report heading: "Required", "Invalid" or a half-configured feature. */
  section: string;
  name: string;
  message: string;
  level: "error" | "warn";
};

export type EnvReport = {
  problems: Problem[];
  /** Features with none of their variables set. */
  off: string[];
  fatal: boolean;
};

const entries = Object.entries(schema) as [EnvName, EnvVar][];

export function validateEnv(
  source: Record<string, string | undefined>
): EnvReport {
  const problems: Problem[] = [];
  const isSet = (name: EnvName) => Boolean(resolve(source, name));

  for (const [name, spec] of entries) {
    const value = resolve(source, name);
    if (!value) {
      if (spec.required && !spec.unless?.(source)) {
        problems.push({
          section: "Required",
          name,
          message: `missing: ${spec.description}`,
          level: spec.required
        });
      }
      continue;
    }
    const issue = spec.type?.safeParse(value).error?.issues[0];
    if (issue) {
      problems.push({
        section: "Invalid",
        name,
        // A secret's value never reaches the report.
        message: issue.message + (spec.secret ? "" : ` (got "${value}")`),
        level: "warn"
      });
    }
  }

  const off: string[] = [];
  for (const [group, label] of Object.entries(FEATURES)) {
    const vars = entries.filter(([, spec]) => spec.group === group);
    const needed = vars.filter(([, spec]) => spec.needed).map(([name]) => name);
    const present = needed.filter(isSet);
    if (!vars.some(([name]) => isSet(name))) {
      off.push(label);
    } else if (present.length > 0 && present.length < needed.length) {
      for (const name of needed.filter((n) => !isSet(n))) {
        problems.push({
          section: `${label} (half-configured)`,
          name,
          message: `missing, but ${present.join(", ")} is set`,
          level: "warn"
        });
      }
    }
  }

  return { problems, off, fatal: problems.some((p) => p.level === "error") };
}

export function formatReport({ problems, off, fatal }: EnvReport) {
  const count = `${problems.length} problem${problems.length === 1 ? "" : "s"} with its environment`;
  const lines = [
    fatal
      ? `Carbon can't start: ${count}`
      : `Carbon started with ${count} (! will stop startup in the next release)`
  ];
  const width = Math.max(0, ...problems.map((p) => p.name.length));
  for (const section of new Set(problems.map((p) => p.section))) {
    lines.push("", `  ${section}`);
    for (const p of problems.filter((p) => p.section === section)) {
      const mark = p.level === "error" ? "✗" : "!";
      lines.push(`    ${mark} ${p.name.padEnd(width)}   ${p.message}`);
    }
  }
  if (off.length) {
    lines.push("", `  Off, because they aren't configured: ${off.join(", ")}`);
  }
  return lines.join("\n");
}
