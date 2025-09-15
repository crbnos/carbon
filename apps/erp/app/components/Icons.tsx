import type { Database } from "@carbon/database";
import { Badge, cn, Status } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuAtom,
  LuBarcode,
  LuBox,
  LuCircle,
  LuCircleCheck,
  LuCircleX,
  LuClipboardCheck,
  LuClock,
  LuClock3,
  LuExternalLink,
  LuFlaskConical,
  LuGroup,
  LuHammer,
  LuHardHat,
  LuHeadphones,
  LuHexagon,
  LuImage,
  LuList,
  LuPizza,
  LuQrCode,
  LuShoppingCart,
  LuSquare,
  LuSwords,
  LuTimer,
  LuToggleLeft,
  LuUser,
} from "react-icons/lu";

import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetOff } from "react-icons/tb";

import { useMode } from "@carbon/remix";
import { getColor } from "@carbon/utils";
import { Link } from "@remix-run/react";
import type { ReactNode } from "react";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { JobOperation } from "~/modules/production/types";
import type { nonConformanceTaskStatus } from "~/modules/quality";
import type { MethodType } from "~/modules/shared";

export const ModuleIcon = ({ icon }: { icon: ReactNode }) => {
  return (
    <div className="h-6 w-6 rounded-lg border border-primary/30 bg-gradient-to-tr from-primary/20 to-primary/10 flex items-center justify-center text-primary text-sm">
      {icon}
    </div>
  );
};

export const MethodItemTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Part":
      return <AiOutlinePartition className={className} />;
    case "Material":
      return <LuAtom className={className} />;
    case "Tool":
      return <LuHammer className={className} />;
    case "Consumable":
      return <LuPizza className={className} />;
    case "Service":
      return <LuHeadphones className={className} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};

export const MethodIcon = ({
  type,
  className,
  isKit,
}: {
  type: string;
  className?: string;
  isKit?: boolean;
}) => {
  switch (type) {
    case "Method":
      return (
        <AiOutlinePartition className={cn(className, "text-foreground")} />
      );
    case "Buy":
      return <LuShoppingCart className={cn("text-blue-500", className)} />;
    case "Make":
      return isKit ? (
        <LuHexagon className={cn("text-emerald-500", className)} />
      ) : (
        <RxCodesandboxLogo className={cn("text-emerald-500", className)} />
      );
    case "Pick":
      return <FaCodePullRequest className={cn("text-yellow-500", className)} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};

type MethodBadgeProps = {
  type: "Buy" | "Make" | "Pick" | "Make Inactive";
  text: string;
  to: string;
  className?: string;
};

export function MethodBadge({ type, text, to, className }: MethodBadgeProps) {
  const mode = useMode();
  const style = getReplenishmentBadgeColor(type, mode);
  return (
    <Link to={to} prefetch="intent" className="group flex items-center gap-1">
      <Badge style={style} className={className}>
        <MethodIcon
          type={type === "Make Inactive" ? "Make" : type}
          className="w-3 h-3 mr-1 "
        />
        {text}
      </Badge>
      <span className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground">
        <LuExternalLink />
      </span>
    </Link>
  );
}

function getReplenishmentBadgeColor(
  type: MethodType | "Make Inactive",
  mode: "light" | "dark"
) {
  return type === "Buy"
    ? getColor("blue", mode)
    : type === "Make"
    ? getColor("green", mode)
    : type === "Make Inactive"
    ? getColor("gray", mode)
    : getColor("orange", mode);
}

export const OnshapeStatus = ({
  status,
  className,
}: {
  status: string;
  className?: string;
}) => {
  switch (status) {
    case "In progress":
      return <AlmostDoneIcon className={className} />;
    case "Released":
      return <LuCircleCheck className={cn("text-blue-600", className)} />;
    case "Rejected":
      return <LuCircleX className={cn("text-red-600", className)} />;
    case "Pending":
      return <InProgressStatusIcon className={className} />;
    default:
      return <Status color="gray">{status}</Status>;
  }
};

export function OperationStatusIcon({
  status,
  className,
}: {
  status: JobOperation["status"];
  className?: string;
}) {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className={cn("text-foreground", className)} />;
    case "Waiting":
    case "Canceled":
      return <LuCircleX className={cn("text-muted-foreground", className)} />;
    case "Done":
      return <LuCircleCheck className={cn("text-blue-600", className)} />;
    case "In Progress":
      return <AlmostDoneIcon className={className} />;
    case "Paused":
      return <InProgressStatusIcon className={className} />;
    default:
      return null;
  }
}

export const IssueTaskStatusIcon = ({
  status,
  className,
}: {
  status: (typeof nonConformanceTaskStatus)[number];
  className?: string;
}) => {
  switch (status) {
    case "Pending":
      return <TodoStatusIcon className={cn("text-foreground", className)} />;
    case "Skipped":
      return <LuCircleX className={cn("text-muted-foreground", className)} />;
    case "Completed":
      return <LuCircleCheck className={cn("text-blue-600", className)} />;
    case "In Progress":
      return <AlmostDoneIcon className={className} />;
    default:
      return null;
  }
};

export const QuoteLineStatusIcon = ({
  status,
}: {
  status: Database["public"]["Enums"]["quoteLineStatus"];
}) => {
  switch (status) {
    case "Not Started":
      return <LuCircle size={12} className="text-blue-600" />;
    case "No Quote":
      return <LuCircleX size={12} className="text-red-600" />;
    case "Complete":
      return <LuCircleCheck size={12} className="text-emerald-600" />;
    case "In Progress":
      return <LuClock3 size={12} className="text-yellow-600" />;
    default:
      return null;
  }
};

export const ProcedureStepTypeIcon = ({
  type,
  className,
}: {
  type: Database["public"]["Enums"]["procedureStepType"];
  className?: string;
}) => {
  switch (type) {
    case "Task":
      return <LuClipboardCheck className={cn("text-amber-500", className)} />;
    case "Value":
      return <LuQrCode className={cn("text-foreground", className)} />;
    case "Measurement":
      return <LuFlaskConical className={cn("text-emerald-500", className)} />;
    case "Checkbox":
      return <LuToggleLeft className={cn("text-purple-600", className)} />;
    case "Timestamp":
      return <LuClock className={cn("text-blue-500", className)} />;
    case "Person":
      return <LuUser className={cn("text-yellow-600", className)} />;
    case "List":
      return <LuList className={cn("text-orange-600", className)} />;
    case "File":
      return <LuImage className={cn("text-indigo-500", className)} />;
  }
};

export const ReplenishmentSystemIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Buy":
      return <LuShoppingCart className={cn("text-blue-500", className)} />;
    case "Make":
      return (
        <RxCodesandboxLogo className={cn("text-emerald-500", className)} />
      );
    case "Buy and Make":
      return <LuSwords className={cn("text-yellow-500", className)} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};

export const TrackingTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Serial":
      return <LuBarcode className={cn("text-foreground", className)} />;
    case "Batch":
      return <LuGroup className={cn("text-emerald-500", className)} />;
    case "Inventory":
      return <LuBox className={cn("text-blue-500", className)} />;
    case "Non-Inventory":
      return <TbTargetOff className={cn("text-red-500", className)} />;
    default:
      return <LuSquare className={cn("text-muted-foreground", className)} />;
  }
};

export const TimeTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Setup":
      return <LuTimer className={className} />;
    case "Labor":
      return <LuHardHat className={className} />;
    case "Machine":
      return <LuHammer className={className} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};
