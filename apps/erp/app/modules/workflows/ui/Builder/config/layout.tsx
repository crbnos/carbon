import {
  cn,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";

const GAP: Record<number, string> = {
  3: "gap-3",
  4: "gap-4"
};

// Stretches children to full width — `VStack` is `items-start`, which shrinks
// every child to its content.
export function FormStack({
  spacing = 4,
  children
}: {
  spacing?: 3 | 4;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full flex-col", GAP[spacing])}>{children}</div>
  );
}

export function Section({
  children,
  hint
}: {
  children: ReactNode;
  /** Explains the setting on hover, so the form stays a column of controls. */
  hint?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
      <span>{children}</span>
      {hint && (
        <>
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t`More information`}
                className="inline-flex size-4 items-center justify-center rounded-full transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LuInfo className="size-3" aria-hidden />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              align="start"
              className="w-auto max-w-xs p-3 text-xs font-normal leading-relaxed text-pretty text-muted-foreground"
            >
              {hint}
            </HoverCardContent>
          </HoverCard>
          {/* The popup is pointer-only; a reader gets the same sentence inline. */}
          <span className="sr-only">{hint}</span>
        </>
      )}
    </div>
  );
}
