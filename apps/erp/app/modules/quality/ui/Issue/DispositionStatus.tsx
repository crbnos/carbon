import { cn, Status } from "@carbon/react";
import type { ComponentProps } from "react";

type StatusColor = ComponentProps<typeof Status>["color"];

const dispositionColors: Record<string, StatusColor> = {
  "Conditional Acceptance": "blue",
  "Deviation Accepted": "green",
  Hold: "yellow",
  "No Action Required": "blue",
  Pending: "orange",
  Quarantine: "red",
  Repair: "yellow",
  "Return to Supplier": "red",
  Rework: "yellow",
  Scrap: "red",
  "Use As Is": "green"
};

export function DispositionStatus({
  disposition,
  className
}: {
  disposition: string;
  className?: string;
}) {
  const color = dispositionColors[disposition] ?? "gray";
  return (
    <Status
      color={color}
      className={cn("max-w-full [&>svg]:shrink-0", className)}
    >
      <span className="min-w-0 truncate">{disposition}</span>
    </Status>
  );
}
