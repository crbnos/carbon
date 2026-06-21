import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Checklist, Check } from "@/components/checklist";
import { Field, FieldTable } from "@/components/editorial/field-table";
import { Glossary } from "@/components/editorial/glossary";
// Figure/Screenshot + the shared Zoomable island so the Reference gets the same
// click-to-enlarge visuals as the Guide (one component, both surfaces).
import { Figure, Screenshot } from "@/components/editorial/mdx";
// Editorial Callout/Card so the Reference matches the Guide (not Fumadocs defaults).
import { Callout, Card, Cards, EnvVar, EnvVars, PlanBadge } from "@/components/editorial/reference-components";
import { StatusFlow, Status } from "@/components/editorial/status-flow";
import { Term } from "@/components/editorial/term";
import { Zoomable } from "@/components/editorial/zoomable";
import { FeatureCallout } from "@/components/feature-callout";
import { Frame } from "@/components/frame";
import { Eyebrow } from "@/components/prose";
import { ScrollReveal } from "@/components/scroll-reveal";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fenced code → Fumadocs' CodeBlock (language icon + label, copy button). The
    // `data-language` is stamped on by a Shiki transformer (source.config.ts) and shown
    // as the header title; `.ed-codeblock` restyles the chrome to the warm-paper dark
    // panel in reference.css.
    pre: ({ ref: _ref, className, title, ...props }: ComponentProps<"pre">) => {
      const lang = (props as Record<string, unknown>)["data-language"] as string | undefined;
      return (
        <CodeBlock {...props} title={title ?? lang} className={`ed-codeblock ${className ?? ""}`}>
          <Pre>{props.children}</Pre>
        </CodeBlock>
      );
    },
    // Reference tables can be wide (many columns). On a phone the prose column is
    // ~330px, so wrap every table in a horizontal scroller — it keeps the rounded
    // frame and lets the table scroll instead of forcing the page to.
    table: ({ children, ...props }: ComponentProps<"table">) => (
      <div className="-mx-[2px] my-5 overflow-x-auto overscroll-x-contain">
        <table {...props} className="!my-0 min-w-full">
          {children}
        </table>
      </div>
    ),
    // Markdown images zoom too, via the same shared lightbox the Guide figures use.
    img: ({ alt, ...props }: ComponentProps<"img">) => (
      <Zoomable>
        <img {...props} alt={alt ?? ""} className="block w-full rounded-xl border border-ed-hairline" />
      </Zoomable>
    ),
    Card,
    Cards,
    Callout,
    EnvVar,
    EnvVars,
    FieldTable,
    Field,
    Glossary,
    StatusFlow,
    Status,
    Figure,
    Screenshot,
    PlanBadge,
    Term,
    Step,
    Steps,
    Tab,
    Tabs,
    ScrollReveal,
    FeatureCallout,
    Checklist,
    Check,
    Frame,
    Eyebrow,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
