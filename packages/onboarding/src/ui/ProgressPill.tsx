import { cn } from "@carbon/react";

// Small per-page progress chip so every working page shows where you are at a
// glance (orientation + motivation), the way the command center does.
export function ProgressPill({
  done,
  total,
  label
}: {
  done: number;
  total: number;
  label: string;
}) {
  if (total === 0) return null;
  const allDone = done === total;
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums whitespace-nowrap",
        allDone
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          allDone ? "bg-emerald-500" : "bg-primary"
        )}
      />
      {done}/{total} {label}
    </span>
  );
}
