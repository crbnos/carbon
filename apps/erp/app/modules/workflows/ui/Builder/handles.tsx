import { cn } from "@carbon/react";

// Handle appearance, kept out of `NodeCard` so `OutputHandle` can share it without
// the two importing each other.

export type PortTone = "default" | "success" | "failure";

const HANDLE_BASE =
  "!size-3.5 !min-w-0 !min-h-0 !rounded-full !border-2 !border-card !transition-shadow";

const HANDLE_TONE: Record<PortTone, string> = {
  default: "!bg-primary hover:!shadow-[0_0_0_5px_hsl(var(--primary)/0.22)]",
  success:
    "!bg-emerald-500 hover:!shadow-[0_0_0_5px_rgb(16_185_129/0.3)] dark:!bg-emerald-400",
  failure:
    "!bg-red-500 hover:!shadow-[0_0_0_5px_rgb(239_68_68/0.3)] dark:!bg-red-400"
};

export function handleClass(tone: PortTone = "default"): string {
  return `${HANDLE_BASE} ${HANDLE_TONE[tone]}`;
}

export const HANDLE_CLASS = handleClass();

const LABEL_TONE: Record<PortTone, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  failure: "text-red-600 dark:text-red-400"
};

// Always to the right of its handle, never the left — the left edge belongs to the
// incoming edge. Anchors on a zero-width box sitting on the card's right border.
export function PortLabel({
  label,
  tone = "default",
  lifted = false
}: {
  label: string;
  tone?: PortTone;
  /** Nudged above the centre line so an edge leaving this handle runs clear
   * underneath. Only worth it when there is an edge — otherwise it looks crooked. */
  lifted?: boolean;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-0 top-1/2 translate-x-[calc(100%+0.75rem)] whitespace-nowrap rounded bg-background/80 px-1 text-[10px] font-medium",
        lifted ? "-translate-y-[115%]" : "-translate-y-1/2",
        LABEL_TONE[tone]
      )}
    >
      {label}
    </span>
  );
}
