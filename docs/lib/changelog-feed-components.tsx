// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createElement, Fragment, type ReactNode } from "react";
import { SITE } from "@/lib/seo";

/* What a changelog entry's MDX becomes inside the RSS feed.
 *
 * Feed readers and email clients run no components and load no stylesheets, so every
 * editorial component an entry may use needs a plain-HTML stand-in here. A component
 * with no entry in this map renders as `undefined` and FAILS THE BUILD — that is
 * deliberate: a newsletter that silently drops a section is worse than a broken build.
 * Adding a component to the changelog's vocabulary means adding its degrade here. */

type Props = { children?: ReactNode };

function absoluteUrl(href: string | undefined): string | undefined {
  // Feed readers have no page URL to resolve site-relative links against.
  return href?.startsWith("/") ? `${SITE.url}${href}` : href;
}

function el(tag: string, props: Record<string, unknown> | null, ...kids: ReactNode[]) {
  return createElement(tag, props, ...kids);
}

export const FEED_COMPONENTS = {
  a: ({ href, children }: Props & { href?: string }) =>
    el("a", { href: absoluteUrl(href) }, children),

  Accordion: ({ title, children }: Props & { title: string }) =>
    createElement(Fragment, null, el("h3", null, title), children),

  // Same shape the page gives it: a titled section, not a collapsed aside.
  Callout: ({ title, children }: Props & { type?: string; title?: ReactNode }) =>
    el("blockquote", null, title ? el("p", null, el("strong", null, title)) : null, children),

  Steps: ({ children }: Props) => el("ol", null, children),
  Step: ({ children }: Props) => el("li", null, children),

  Cards: ({ children }: Props) => el("ul", null, children),
  Card: ({ title, href, children }: Props & { title?: ReactNode; href?: string }) =>
    el(
      "li",
      null,
      href ? el("a", { href: absoluteUrl(href) }, el("strong", null, title)) : el("strong", null, title),
      children ? el(Fragment as never, null, " — ", children) : null
    ),

  // `label` is the alt text; an unfilled slot has no image to send, so only its
  // caption travels rather than a dangling <img>.
  Screenshot: ({ src, label, caption }: { src?: string; label: string; caption?: string }) =>
    el(
      "figure",
      null,
      src ? el("img", { src: absoluteUrl(src), alt: label }) : null,
      caption ? el("figcaption", null, caption) : null
    ),

  // A Figure is an inline SVG diagram; it cannot survive a mail client, so it
  // degrades to its caption alone.
  Figure: ({ caption }: { illustration?: string; caption?: string }) =>
    caption ? el("p", null, el("em", null, caption)) : null,

  PlanBadge: ({ plan = "Business" }: { plan?: string }) =>
    el("em", null, `(Available on the ${plan} plan)`),

  // Glossary tooltips are page-only; the word itself is what matters.
  Term: ({ children }: Props) => createElement(Fragment, null, children),
};
