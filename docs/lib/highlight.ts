// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "server-only";
import { type Highlighter, createHighlighter } from "shiki";

// One highlighter per build worker, reused across every endpoint.
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: [
        "bash",
        "javascript",
        "python",
        "go",
        "php",
        "ruby",
        "java",
        "csharp",
        "json"
      ],
    });
  }
  return highlighterPromise;
}

const LANG: Record<string, string> = {
  curl: "bash",
  javascript: "javascript",
  python: "python",
  go: "go",
  php: "php",
  ruby: "ruby",
  java: "java",
  csharp: "csharp",
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
