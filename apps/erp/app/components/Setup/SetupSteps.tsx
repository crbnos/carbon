// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { LuCheck } from "react-icons/lu";
import { Link } from "react-router";

type SetupStepsProps<Step extends string> = {
  steps: readonly Step[];
  current: Step;
  labels: Record<Step, string>;
  /** The stepper's accessible name, e.g. "Contract setup". */
  label: string;
  /** Where each step lives. Absent while the record is being created: no
   *  later step exists yet, so nothing links. */
  to?: (step: Step) => string;
};

/** A setup wizard's steps, numbered, the current one underlined. Every step
 *  of a saved record is a link — each step saves as it goes, so moving
 *  between them never loses anything. */
function SetupSteps<Step extends string>({
  steps,
  current,
  labels,
  label,
  to
}: SetupStepsProps<Step>) {
  const currentIndex = steps.indexOf(current);

  return (
    <nav aria-label={label} className="w-full overflow-x-auto">
      <ol className="flex items-center gap-8">
        {steps.map((step, index) => {
          const isCurrent = step === current;
          const isDone = index < currentIndex;
          const content = (
            <span
              className={cn(
                "flex items-center gap-2 border-b-2 pb-3 text-sm whitespace-nowrap transition-colors",
                isCurrent
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground",
                to && !isCurrent && "hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                  isCurrent
                    ? "border-foreground bg-foreground text-background"
                    : isDone
                      ? "border-foreground/40 text-foreground"
                      : "border-border"
                )}
              >
                {isDone ? <LuCheck className="size-3" /> : index + 1}
              </span>
              {labels[step]}
            </span>
          );

          return (
            <li key={step} aria-current={isCurrent ? "step" : undefined}>
              {to && !isCurrent ? (
                <Link
                  to={to(step)}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm block"
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default SetupSteps;
