import { getEntry, type TermId } from "@carbon/glossary";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard";
import { HStack } from "./HStack";
import { cn } from "./utils/cn";

const DOCS_BASE_URL = "https://docs.carbon.ms";

type LabelWithHelpProps = {
  termId: TermId | undefined;
  children: ReactNode;
  className?: string;
  /** Delay (ms) before the help popup opens on hover. */
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

  // HoverCard (not Tooltip): the popup contains an interactive "Learn more"
  // link, so the pointer must be able to travel from the icon into the popup
  // without it closing. HoverCard keeps a hover bridge across that gap; a
  // Tooltip dismisses the moment the pointer leaves the trigger.
  const trigger = (
    <HoverCard openDelay={tooltipDelayDuration} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t`What is ${translatedTerm}?`}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Stacked labels sit above a form control: the 20px button is 4px
            // taller than the text-xs (16px) line, which would push the input
            // down and misalign it with tooltip-less fields in a grid. The
            // -2px vertical margin collapses the button's margin-box back to
            // the text line height so the row height is identical either way;
            // the hover ring overhangs harmlessly and the icon stays in line.
            isInline ? "h-4 w-4" : "h-5 w-5 -my-0.5"
          )}
        >
          <LuInfo
            className={isInline ? "h-3 w-3" : "h-3.5 w-3.5"}
            aria-hidden
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-auto max-w-xs p-3 text-xs text-pretty leading-relaxed text-muted-foreground"
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
      </HoverCardContent>
    </HoverCard>
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
