import { Link } from "react-router";

function FooterChevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={dir === "left" ? "M8.5 3.5L5 7l3.5 3.5" : "M5.5 3.5L9 7l-3.5 3.5"}
        stroke="rgba(38,35,35,0.55)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Prev/next navigation card — mirrors the docs reader's ChapterCard, as a router Link. */
export function ChapterCard({
  dir,
  title,
  to
}: {
  dir: "prev" | "next";
  title: string;
  to: string;
}) {
  const next = dir === "next";
  return (
    <Link
      to={to}
      className={`group flex w-full items-center gap-2.5 rounded-xl border border-ed-hairline bg-ed-paper/60 px-4 py-3 text-left no-underline shadow-[inset_0_1px_0_#fff] transition-colors hover:border-ed-warm-400 hover:bg-white/70 ${
        next ? "flex-row-reverse text-right" : ""
      }`}
    >
      <FooterChevron dir={next ? "right" : "left"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink/72">
          {next ? "Next" : "Previous"}
        </span>
        <span className="truncate text-ed-15 font-semi text-ink-ui transition-colors group-hover:text-ed-ink">
          {title}
        </span>
      </span>
    </Link>
  );
}
