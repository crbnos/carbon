import { getEntry, type TermId } from "@carbon/glossary";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";
import { HStack } from "./HStack";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./Tooltip";
import { cn } from "./utils/cn";

const DOCS_BASE_URL = "https://docs.carbon.ms";

type LabelWithHelpProps = {
  termId: TermId | undefined;
  children: ReactNode;
  description?: ReactNode;
  className?: string;
  tooltipDelayDuration?: number;
};

export function LabelWithHelp({
  termId,
  children,
  description,
  className,
  tooltipDelayDuration = 200
}: LabelWithHelpProps) {
  if (termId === undefined) return <>{children}</>;
  const entry = getEntry(termId);

  const showLearnMore = description === undefined && entry.href !== undefined;

  return (
    <HStack spacing={1} className={cn("items-center", className)}>
      <span>{children}</span>
      <TooltipProvider delayDuration={tooltipDelayDuration}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What is ${entry.term}?`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LuInfo className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-xs text-pretty leading-relaxed text-muted-foreground"
          >
            {description ?? entry.definition}
            {showLearnMore && (
              <>
                {" "}
                <a
                  href={`${DOCS_BASE_URL}${entry.href}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid"
                >
                  Learn more
                </a>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="sr-only">{entry.definition}</span>
    </HStack>
  );
}
