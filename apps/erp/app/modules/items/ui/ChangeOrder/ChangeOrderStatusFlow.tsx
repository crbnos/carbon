import { cn, Menubar } from "@carbon/react";
import { LuCheck, LuCircle, LuCircleDot } from "react-icons/lu";
import { changeOrderStatus } from "../../changeOrder.models";
import type { ChangeOrderStatus } from "../../types";

// The change-order stage flow, mirroring the sales OpportunityState bar: one
// static label per stage with a progress icon that turns emerald on the active
// (and completed) stages — the "green dot" on the current step. Display-only
// (stage changes go through the header's advance/release action), so each stage
// is a plain <p>, not a button — no hover/click affordance, just the progress bar.
export default function ChangeOrderStatusFlow({
  status
}: {
  status: ChangeOrderStatus;
}) {
  const activeIndex = changeOrderStatus.indexOf(status);

  return (
    <Menubar>
      {changeOrderStatus.map((stage, index) => {
        const isCurrent = index === activeIndex;
        const isCompleted = index < activeIndex;
        const Icon = isCompleted ? LuCheck : isCurrent ? LuCircleDot : LuCircle;
        return (
          <p
            key={stage}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-sm",
              isCurrent
                ? "text-foreground font-semibold"
                : isCompleted
                  ? "text-foreground/70"
                  : "text-muted-foreground"
            )}
          >
            <Icon
              className={cn(
                (isCurrent || isCompleted) && "text-emerald-500",
                !isCurrent && !isCompleted && "opacity-80"
              )}
            />
            {stage}
          </p>
        );
      })}
    </Menubar>
  );
}
