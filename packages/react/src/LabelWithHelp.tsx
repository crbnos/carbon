import { getEntry, type TermId } from "@carbon/glossary";
import { Trans, useLingui } from "@lingui/react/macro";
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
  className?: string;
  tooltipDelayDuration?: number;
  /**
   * `stacked` (default): pairs with a form control below, sits inside an
   * `HStack` next to the label. `inline`: drops the stack wrapper and uses a
   * smaller hit-target so the icon sits flush with body-sized text (grid
   * headers, card-attribute keys).
   */
  variant?: "stacked" | "inline";
};

export function LabelWithHelp({
  termId,
  children,
  className,
  tooltipDelayDuration = 200,
  variant = "stacked"
}: LabelWithHelpProps) {
  // Hooks must run unconditionally — call useLingui before any early return.
  const { t, i18n } = useLingui();
  if (termId === undefined) return <>{children}</>;
  const entry = getEntry(termId);

  const translatedTerm = i18n._(entry.term);
  const translatedDefinition = i18n._(entry.definition);
  const showLearnMore = entry.href !== undefined;
  const isInline = variant === "inline";

  const trigger = (
    <TooltipProvider delayDuration={tooltipDelayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t`What is ${translatedTerm}?`}
            className={cn(
              "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isInline ? "h-4 w-4" : "h-5 w-5"
            )}
          >
            <LuInfo
              className={isInline ? "h-3 w-3" : "h-3.5 w-3.5"}
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-xs text-pretty leading-relaxed text-muted-foreground"
        >
          {translatedDefinition}
          {showLearnMore && (
            <>
              {" "}
              <a
                href={`${DOCS_BASE_URL}${entry.href}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid"
              >
                <Trans>Learn more</Trans>
              </a>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  // sr-only mirror so screen readers reach the full definition without needing
  // to activate the tooltip trigger.
  const srOnly = <span className="sr-only">{translatedDefinition}</span>;

  if (isInline) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <span>{children}</span>
        {trigger}
        {srOnly}
      </span>
    );
  }

  return (
    <HStack spacing={1} className={cn("items-center", className)}>
      <span>{children}</span>
      {trigger}
      {srOnly}
    </HStack>
  );
}
