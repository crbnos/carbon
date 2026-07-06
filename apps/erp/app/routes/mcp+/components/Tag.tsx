import { cn } from "@carbon/react";

const KIND_CLASSES = {
  READ: "text-[#1f7a52] bg-[#dcefe6] dark:text-[#79d3a6] dark:bg-[#14241c]",
  WRITE: "text-[#9a5a0c] bg-[#f2e6d3] dark:text-[#e0a24a] dark:bg-[#2a2113]",
  DESTRUCTIVE:
    "text-[#b23123] bg-[#f2dcd8] dark:text-[#f08a7c] dark:bg-[#2c1714]"
} as const;

export function Tag({
  kind,
  className
}: {
  kind: keyof typeof KIND_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block font-[var(--mono)] text-[0.6rem] font-bold tracking-[0.04em] px-[6px] py-[2px] rounded-[4px]",
        KIND_CLASSES[kind],
        className
      )}
    >
      {kind}
    </span>
  );
}
