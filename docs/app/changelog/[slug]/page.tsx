import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { formatChangelogDate } from "@/lib/changelog";
import { pageSeo } from "@/lib/seo";
import { changelogSource, getChangelogEntries } from "@/lib/source";

type Params = { params: Promise<{ slug: string }> };

/** Permalink page for one changelog entry — the shareable, canonical URL.
 *  Same anatomy as a feed entry: date + tags, big title, optional hero, prose. */
export default async function ChangelogEntryPage(props: Params) {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="mx-auto max-w-190">
      <Link
        href="/changelog"
        className="text-ed-14 font-book text-ink-faint no-underline hover:text-ink-ui"
      >
        ← Changelog
      </Link>
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <time
          dateTime={page.data.date}
          className="text-ed-14 font-book text-ink-faint"
        >
          {formatChangelogDate(page.data.date)}
        </time>
        {page.data.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-ed-hairline bg-[#F5F5F2] px-2 py-0.5 text-[11.5px] font-book leading-normal text-ink-faint"
          >
            {tag}
          </span>
        ))}
      </div>
      <h1 className="reference-title m-0 mt-2.5">{page.data.title}</h1>
      {page.data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.data.image}
          alt={page.data.title}
          className="mt-7 w-full rounded-xl border border-ed-hairline bg-[#F5F5F2]"
        />
      )}
      <div className="prose mt-[30px]">
        <MDX components={getMDXComponents()} />
      </div>
      <div className="mt-12 border-t border-ed-hairline pt-6">
        <Link
          href="/changelog"
          className="text-ed-14 text-[#1E84B0] no-underline hover:underline"
        >
          ← All changelog entries
        </Link>
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return getChangelogEntries().map((entry) => ({
    slug: entry.slugs[entry.slugs.length - 1],
  }));
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  return pageSeo({
    title: `${page.data.title} — Carbon Changelog`,
    ogTitle: page.data.title,
    description: page.data.description,
    path: page.url,
    eyebrow: "Changelog",
  });
}
