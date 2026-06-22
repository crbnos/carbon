import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Field, FieldTable } from "./field-table";
import { type IllustrationKey, illustrations } from "./illustrations";
import { Status, StatusFlow } from "./status-flow";
import { Term } from "./term";
import { Zoomable } from "./zoomable";

/* The editorial MDX component map. Guide chapters are authored as MDX and rendered
 * through these — markdown elements get the warm-paper prose styling, and the custom
 * <Figure>/<Screenshot>/<Callout> components carry the structured pieces the design
 * needs. Section headings stay as `##` so Fumadocs' rehype-slug gives every section a
 * stable id, which the rail and scrollspy key off. */

function ImageGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="rgba(38,35,35,0.35)" strokeWidth="1.4" />
      <circle cx="8.5" cy="10" r="1.6" fill="rgba(38,35,35,0.3)" />
      <path d="M5 17l4.5-4.5 3 3L16 11l3 3.2" stroke="rgba(38,35,35,0.35)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const badgeToneClasses: Record<string, string> = {
  neutral: "border-ed-warm-400 bg-ed-warm-150 text-ed-ink/72",
  blue: "border-ed-blue-border bg-ed-blue-bg text-[#2A6A8A]",
  green: "border-ed-green-border bg-ed-green-bg text-[#3F7A33]",
  amber: "border-ed-amber-stroke bg-ed-amber-fill text-[#835F20]",
};

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-ed-11 leading-3.5 tracking-[0.03em] ${badgeToneClasses[tone] || badgeToneClasses.neutral}`}
    >
      {children}
    </span>
  );
}

export function Figure({ illustration, caption }: { illustration: IllustrationKey; caption?: string }) {
  const Illustration = illustrations[illustration];
  return (
    <figure className="my-10">
      <Zoomable>
        <div className="rounded-xl border border-ed-hairline bg-ed-paper px-6 py-7 shadow-[inset_0_1px_0_#fff]">
          {Illustration ? <Illustration /> : null}
        </div>
      </Zoomable>
      {caption && (
        <figcaption className="mt-3 text-center text-ed-12 text-ink-faint">{caption}</figcaption>
      )}
    </figure>
  );
}

export function Screenshot({
  label,
  caption,
  ratio = "wide",
}: {
  label: string;
  caption?: string;
  ratio?: "wide" | "tall" | "square";
}) {
  const aspect =
    ratio === "tall" ? "aspect-[3/4]" : ratio === "square" ? "aspect-square" : "aspect-[16/9]";
  return (
    <figure className="my-10">
      <Zoomable>
        <div
          className={`relative w-full ${aspect} rounded-xl border border-dashed border-ed-warm-500 bg-ed-header overflow-hidden`}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
            <ImageGlyph />
            <span className="font-mono text-ed-10 tracking-[0.08em] uppercase text-ed-ink/70">
              Carbon screenshot
            </span>
            <span className="text-ed-14 font-medium text-ed-ink/78 max-w-90">{label}</span>
          </div>
        </div>
      </Zoomable>
      {caption && (
        <figcaption className="mt-3 text-center text-ed-12 text-ink-faint">{caption}</figcaption>
      )}
    </figure>
  );
}

export function Callout({
  tone = "neutral",
  badge,
  title,
  children,
}: {
  tone?: "neutral" | "blue" | "green" | "amber";
  badge: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="my-12 callout-box p-2">
      <div className="w-full callout-box-inner px-[22px] py-5">
        <Badge tone={tone}>{badge}</Badge>
        <p className="m-0 mt-2.5 text-ed-18 font-demi leading-[140%] text-ink">{title}</p>
        {/* div, not p: MDX already wraps the callout body in a paragraph, so a <p> here
            would nest <p><p>…</p></p> (invalid → hydration mismatch). */}
        <div className="m-0 mt-3 text-ed-15 font-book leading-[160%] tracking-[0.15px] text-ed-ink/70 [&>p]:m-0">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Divider() {
  return <hr className="my-12 border-none border-t border-ed-hairline" />;
}

function Paragraph(props: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      className="m-0 mt-5 text-ed-15 font-normal leading-[1.72] tracking-[-0.32px] text-ed-ink/78"
    />
  );
}

function UnorderedList(props: ComponentPropsWithoutRef<"ul">) {
  return <ul {...props} className="m-0 mt-5 flex flex-col gap-3 list-none pl-0" />;
}

function ListItem({ children, ...props }: ComponentPropsWithoutRef<"li">) {
  return (
    <li
      {...props}
      className="flex gap-3 items-start text-ed-15 font-normal leading-[1.72] tracking-[-0.32px] text-ed-ink/78"
    >
      <span className="mt-2 shrink-0 w-2 h-2 rounded-[24px] border-[1.5px] border-[rgba(190,190,190,0.50)] bg-ed-warm-100 shadow-[0_1px_1px_0_#FFF,inset_0_0_0.357px_1.071px_#FFF,inset_0_0_0.357px_1.071px_rgba(255,255,255,0.35),inset_0_1.429px_0_0_#FFF]" />
      <span className="flex-1">{children}</span>
    </li>
  );
}

/** Hover anchor on a heading — deep-links to the section, matching the Reference.
 *  Native `#id` jump; `scroll-mt` on the heading clears the fixed chrome. */
function HeadingAnchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="Link to this section"
      className="ml-3 inline-flex items-center align-middle text-ink-faint no-underline opacity-0 transition-[opacity,color] duration-150 hover:text-ed-brand-ink group-hover:opacity-100"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-[0.46em] w-[0.46em]"
      >
        <path d="M9.5 13.5a4 4 0 0 0 6 .4l2.5-2.5a4 4 0 0 0-5.7-5.7L11 7" />
        <path d="M14.5 10.5a4 4 0 0 0-6-.4L6 12.6a4 4 0 0 0 5.7 5.7L13 17" />
      </svg>
    </a>
  );
}

// `##` section headings — the big editorial title each rail item links to. `group`
// reveals the hover anchor; `id` (from rehype-slug) drives anchors + scrollspy.
function Heading2({ id, children, ...props }: ComponentPropsWithoutRef<"h2">) {
  return (
    <h2
      {...props}
      id={id}
      className="group scroll-mt-30 m-0 pt-[50px] text-ed-24 font-normal leading-[115%] text-ink"
    >
      {children}
      {id ? <HeadingAnchor id={id} /> : null}
    </h2>
  );
}

function Heading3({ id, children, ...props }: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      {...props}
      id={id}
      className="group m-0 mt-12 scroll-mt-30 text-ed-20 font-demi leading-[140%] tracking-[0.24px] text-ink"
    >
      {children}
      {id ? <HeadingAnchor id={id} /> : null}
    </h3>
  );
}

function Heading4(props: ComponentPropsWithoutRef<"h4">) {
  return <h4 {...props} className="m-0 mt-8 text-ed-16 font-demi leading-[140%] tracking-[0.15px] text-ink" />;
}

function Blockquote(props: ComponentPropsWithoutRef<"blockquote">) {
  return (
    <blockquote
      {...props}
      className="m-0 mt-5 pl-4 border-l-[2px] border-ed-warm-500 text-ed-15 font-book leading-[160%] tracking-[0.15px] text-ink-faint italic"
    />
  );
}

function Anchor(props: ComponentPropsWithoutRef<"a">) {
  // Underlined by default: in a text block a link must be distinguishable by more than
  // color alone (WCAG 1.4.1) — the underline is the non-color cue.
  return (
    <a
      {...props}
      className="text-ed-blue-deep underline decoration-ed-blue-deep/40 underline-offset-[3px] transition-colors hover:decoration-ed-blue-deep"
    />
  );
}

function HorizontalRule() {
  return <Divider />;
}

export const editorialMdxComponents = {
  p: Paragraph,
  ul: UnorderedList,
  li: ListItem,
  h1: Heading2,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  blockquote: Blockquote,
  hr: HorizontalRule,
  a: Anchor,
  Figure,
  Screenshot,
  Callout,
  Divider,
  Term,
  FieldTable,
  Field,
  StatusFlow,
  Status,
};
