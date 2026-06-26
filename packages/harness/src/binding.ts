export type LoopKind = "bug" | "feature" | "usability" | "copy";

export type Binding = {
  id: string;
  kind: LoopKind;
  title: string;
  risk: "low" | "med" | "high";
  acceptance: string[];
  /** GitHub issue this loop addresses. When set, the PR body gets `Closes #<n>`
   *  so merging auto-closes the issue (the outer-loop state machine). */
  issue?: number;
};

const KINDS: LoopKind[] = ["bug", "feature", "usability", "copy"];

/** Trim surrounding whitespace and a single pair of wrapping quotes. */
function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * Parse the YAML-ish frontmatter of a `.loop.md` binding. No YAML dependency.
 * Scalars may be quoted or bare. The `acceptance` list must be contiguous
 * (one `- item` per line) — a blank line or another key ends it.
 */
export function parseBinding(md: string): Binding {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) throw new Error("Binding has no frontmatter block.");
  const lines = match[1].split("\n");
  const scalars: Record<string, string> = {};
  const acceptance: string[] = [];
  let inAcceptance = false;
  for (const line of lines) {
    if (/^acceptance:\s*$/.test(line)) {
      inAcceptance = true;
      continue;
    }
    if (inAcceptance && /^\s*-\s+/.test(line)) {
      acceptance.push(unquote(line.replace(/^\s*-\s+/, "")));
      continue;
    }
    inAcceptance = false;
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv?.[1]) scalars[kv[1]] = unquote(kv[2] ?? "");
  }
  const id = scalars.id;
  if (!id) throw new Error("Binding missing required field: id");
  const kind = scalars.kind;
  if (!kind || !KINDS.includes(kind as LoopKind)) {
    throw new Error(`Binding kind must be one of ${KINDS.join("|")}`);
  }
  const issue =
    scalars.issue && /^\d+$/.test(scalars.issue)
      ? Number(scalars.issue)
      : undefined;
  return {
    id,
    kind: kind as LoopKind,
    title: scalars.title ?? "",
    risk: (scalars.risk as Binding["risk"]) ?? "low",
    acceptance,
    ...(issue !== undefined ? { issue } : {})
  };
}
