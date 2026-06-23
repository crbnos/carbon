import "server-only";
import { type Highlighter, createHighlighter } from "shiki";

// One highlighter per build worker, reused across every endpoint.
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: ["bash", "javascript", "python", "go", "json"],
    });
  }
  return highlighterPromise;
}

const LANG: Record<string, string> = {
  curl: "bash",
  javascript: "javascript",
  python: "python",
  go: "go",
  json: "json",
};

/** Highlight a code sample to themed HTML at build time (server-only). */
export async function highlight(code: string, key: string): Promise<string> {
  if (!code) return "";
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: LANG[key] ?? "bash",
    theme: "github-dark-default",
  });
}
