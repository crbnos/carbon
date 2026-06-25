import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleAlert, LuCircleCheck, LuClock, LuStamp } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import { getJobOrderStatusCategory } from "../../production.models";
import type { ItemOrderStatus } from "../../types";

// Presentation only — precedence lives in getJobOrderStatusCategory (shared with
// the status filter); this maps the resolved category to an icon + label.
export function JobOrderStatusBadge({
  status
}: {
  status: ItemOrderStatus | undefined;
}) {
  const badge = (icon: ReactNode, label: ReactNode) => (
    <Tooltip>
      <TooltipTrigger className="flex w-5 items-center justify-center">
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const category = getJobOrderStatusCategory(status);

  switch (category) {
    case "inStock":
      return badge(
        <LuCircleCheck className="text-emerald-600" />,
        <Trans>In stock</Trans>
      );
    case "needsOrder":
      return badge(
        <LuCircleAlert className="text-red-500" />,
        <Trans>Order {status?.shortfall} for this job</Trans>
      );
    case "planned":
      return badge(
        <TodoStatusIcon className="text-blue-600" />,
        <Trans>Planned purchase order</Trans>
      );
    case "awaitingApproval":
      return badge(
        <LuStamp className="text-amber-400" />,
        <Trans>Awaiting approval</Trans>
      );
    case "received":
      return badge(
        <InProgressStatusIcon />,
        <Trans>
          Received {status?.received} of {status?.ordered}
        </Trans>
      );
    case "onOrder":
      return badge(<AlmostDoneIcon />, <Trans>On order</Trans>);
    case "plannedJob":
      return badge(
        <LuClock className="text-amber-400" />,
        status?.supplyJobStatus === "Planned" ? (
          <Trans>Planned job</Trans>
        ) : (
          <Trans>Job in progress</Trans>
        )
      );
    default:
      return null;
  }
}
