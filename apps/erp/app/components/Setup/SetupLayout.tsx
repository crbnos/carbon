// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Heading } from "@carbon/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/** The whole setup page: a header with the title and the steps, then the
 *  step's body and its sticky footer. Owns the page's scroll, so the footer
 *  stays in view however long the step is. */
export const SetupFrame = ({
  title,
  subtitle,
  steps,
  step,
  children
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The stepper (`SetupSteps`). */
  steps: ReactNode;
  /** The current step: a new one scrolls the page back to the top. */
  step: string;
  children: ReactNode;
}) => {
  // The frame outlives the steps, so a new step starts at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on step change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  return (
    <div
      ref={scrollRef}
      className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full flex-col overflow-y-auto bg-card scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
    >
      <header className="w-full border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-8 md:px-8">
          <div className="flex min-w-0 flex-col gap-1">
            <Heading size="h3" className="truncate">
              {title}
            </Heading>
            {subtitle && (
              <p className="truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {steps}
        </div>
      </header>
      <div className="flex w-full flex-1 flex-col">{children}</div>
    </div>
  );
};

/** A step's content: centred, capped and generously spaced. */
export const SetupBody = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-10 md:px-8">
    {children}
  </div>
);

/** One group of a step: a heading, one muted line saying what it is for, an
 *  optional action on the right, then its content. Groups after the first
 *  are separated by a hairline. */
export const SetupSection = ({
  title,
  description,
  actions,
  children,
  className
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) => (
  <section
    className={cn(
      "flex w-full min-w-0 flex-col gap-6 [&+&]:border-t [&+&]:border-border [&+&]:pt-12",
      className
    )}
  >
    <div className="flex w-full flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
    {children}
  </section>
);

/** The setup page's bottom bar: a running total on the left, the way back
 *  and the way on to the right. Sticks to the bottom of the page. */
export const SetupFooter = ({
  summary,
  actions
}: {
  summary?: ReactNode;
  actions: ReactNode;
}) => (
  <div className="sticky bottom-0 z-10 w-full border-t border-border bg-card">
    <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 md:px-8">
      <div className="min-w-0 text-sm">{summary}</div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  </div>
);
