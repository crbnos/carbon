import { Button, cn, Menubar } from "@carbon/react";
import { LuCircle, LuCircleCheck, LuCircleDot } from "react-icons/lu";
import { changeOrderStatus } from "../../changeOrder.models";
import type { ChangeOrderStatus } from "../../types";

// The change-order stage flow, mirroring the sales OpportunityState bar: one
// ghost button per stage with a progress icon that turns emerald on the active
// (and completed) stages — the "green dot" on the current step. Display-only
// (stage changes go through the header's advance/release action), so the buttons
// are disabled; they exist for the consistent progress-bar look.
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
        const Icon = isCompleted
          ? LuCircleCheck
          : isCurrent
            ? LuCircleDot
            : LuCircle;
        return (
          <Button
            key={stage}
            variant="ghost"
            isDisabled
            leftIcon={
              <Icon
                className={cn(
                  (isCurrent || isCompleted) && "text-emerald-500",
                  !isCurrent && !isCompleted && "opacity-60"
                )}
              />
            }
          >
            {stage}
          </Button>
        );
      })}
    </Menubar>
  );
}
