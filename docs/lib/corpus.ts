import { type CorpusPage, parsePage } from "@carbon/content/corpus";
import { guideSource, source } from "@/lib/source";

/** Every docs + guide page as stripped markdown, in file-path order. */
export async function getCorpus(): Promise<CorpusPage[]> {
  const files = [
    ...source.getPages().map((page) => ({ file: `docs/${page.path}`, page })),
    ...guideSource
      .getPages()
      .map((page) => ({ file: `guides/${page.path}`, page })),
  ].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return Promise.all(
    files.map(async ({ file, page }) =>
      parsePage(file.replace(/\.mdx$/, ""), await page.data.getText("raw"))
    )
  );
}
