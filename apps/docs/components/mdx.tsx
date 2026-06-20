import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { MdxCodeBlock } from "@/components/api/mdx-code-block";
import { Checklist, Check } from "@/components/checklist";
// Editorial Callout/Card so the Reference matches the Guide (not Fumadocs defaults).
import { Callout, Card, Cards, EnvVar, EnvVars, PlanBadge } from "@/components/editorial/reference-components";
import { Term } from "@/components/editorial/term";
import { FeatureCallout } from "@/components/feature-callout";
import { Frame } from "@/components/frame";
import { Eyebrow } from "@/components/prose";
import { ScrollReveal } from "@/components/scroll-reveal";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fenced code → our dark API-playground panel (not Fumadocs' default block).
    pre: ({ title, children }: ComponentProps<"pre">) => (
      <MdxCodeBlock title={typeof title === "string" ? title : undefined}>{children}</MdxCodeBlock>
    ),
    // Reference tables can be wide (many columns). On a phone the prose column is
    // ~330px, so wrap every table in a horizontal scroller — it keeps the rounded
    // frame and lets the table scroll instead of forcing the page to.
    table: ({ children, ...props }: ComponentProps<"table">) => (
      <div className="-mx-[2px] my-[20px] overflow-x-auto overscroll-x-contain">
        <table {...props} className="!my-0 min-w-full">
          {children}
        </table>
      </div>
    ),
    Card,
    Cards,
    Callout,
    EnvVar,
    EnvVars,
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
