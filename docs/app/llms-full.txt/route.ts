import { getCorpus } from "@/lib/corpus";
import { SITE } from "@/lib/seo";

/* /llms-full.txt — every docs page as component-stripped markdown in one file, for
 * AI assistants that want the whole corpus rather than the /llms.txt index. Shares
 * its stripper with the in-app agent's KB (@carbon/content/corpus), so the two
 * corpora can never disagree. Built once at build time. */

export const dynamic = "force-static";

export async function GET() {
  const pages = await getCorpus();

  const body = pages
    .map(
      (p) =>
        `# ${p.title}\n\nURL: ${SITE.url}/${p.slug.replace(/\/index$/, "")}\n\n${
          p.description ? `> ${p.description}\n\n` : ""
        }${p.markdown}`
    )
    .join("\n\n---\n\n");

  return new Response(`${body}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
