import { readFile } from "node:fs/promises";
import path from "node:path";
import { type CorpusPage, parsePage } from "@carbon/content/corpus";
import { guideSource, source } from "@/lib/source";

// The dir source.config.ts points both collections at. Read directly rather than via
// Fumadocs' getText("raw"): fumadocs-mdx >= 15.2.1 drops the leading "../" of a content
// dir outside the app, so its fullPath doesn't resolve.
const CONTENT_ROOT = path.join(process.cwd(), "../packages/content/mdx");

/** Every docs + guide page as stripped markdown, in file-path order. */
export async function getCorpus(): Promise<CorpusPage[]> {
  const files = [
    ...source.getPages().map((page) => `docs/${page.path}`),
    ...guideSource.getPages().map((page) => `guides/${page.path}`),
  ].sort();
  return Promise.all(
    files.map(async (file) =>
      parsePage(
        file.replace(/\.mdx$/, ""),
        await readFile(path.join(CONTENT_ROOT, file), "utf8")
      )
    )
  );
}
