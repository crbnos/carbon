import { cn } from "@carbon/react";
import type { ReactNode } from "react";

const GAP: Record<number, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4"
};

// Stretches children to full width — `VStack` is `items-start`, which shrinks
// every child to its content.
export function FormStack({
  spacing = 4,
  className,
  children
}: {
  spacing?: 1 | 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full flex-col", GAP[spacing], className)}>
      {children}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-muted-foreground">
      {children}
    </div>
  );
}
