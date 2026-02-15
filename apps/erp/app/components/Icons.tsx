import type { Database } from "@carbon/database";
import type { LinearIssue } from "@carbon/ee/linear";
import { mapLinearStatusToCarbonStatus } from "@carbon/ee/linear";
import {
  Badge,
  cn,
  Status,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { getColor } from "@carbon/utils";
import type { ReactNode } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuAtom,
  LuBarcode,
  LuBox,
  LuCircle,
  LuCircleCheck,
  LuCircleDashed,
  LuCircleX,
  LuClipboardCheck,
  LuClock,
  LuClock3,
  LuExternalLink,
  LuEye,
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
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetOff } from "react-icons/tb";
import { Link } from "react-router";
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
  className
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
  isKit
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
  className
}: {
  status: string;
  className?: string;
}) => {
  const getIcon = () => {
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

  const icon = getIcon();

  // Status component already has tooltip, so return it directly
  if (
    status !== "In progress" &&
    status !== "Released" &&
    status !== "Rejected" &&
    status !== "Pending"
  ) {
    return icon;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export function OperationStatusIcon({
  status,
  className
}: {
  status: JobOperation["status"];
  className?: string;
}) {
  const getIcon = () => {
    switch (status) {
      case "Todo":
        return (
          <LuCircleDashed className={cn("text-muted-foreground", className)} />
        );
      case "Ready":
        return <TodoStatusIcon className={cn("text-blue-600", className)} />;
      case "Waiting":
      case "Canceled":
        return <LuCircleX className={cn("text-red-600", className)} />;
      case "Done":
        return <LuCircleCheck className={cn("text-green-600", className)} />;
      case "In Progress":
        return <AlmostDoneIcon className={className} />;
      case "Paused":
        return <InProgressStatusIcon className={className} />;
      default:
        return null;
    }
  };

  const icon = getIcon();
  if (!icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export const IssueTaskStatusIcon = ({
  status,
  className
}: {
  status: (typeof nonConformanceTaskStatus)[number];
  className?: string;
}) => {
  const getIcon = () => {
    switch (status) {
      case "Pending":
        return <LuCircleDashed className={cn("text-foreground", className)} />;
      case "Skipped":
        return <LuCircleX className={cn("text-muted-foreground", className)} />;
      case "Completed":
        return <LuCircleCheck className={cn("text-emerald-600", className)} />;
      case "In Progress":
        return <AlmostDoneIcon className={className} />;
      default:
        return null;
    }
  };

  const icon = getIcon();
  if (!icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export const QuoteLineStatusIcon = ({
  status
}: {
  status: Database["public"]["Enums"]["quoteLineStatus"];
}) => {
  const getIcon = () => {
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

  const icon = getIcon();
  if (!icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export const ProcedureStepTypeIcon = ({
  type,
  className
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
    case "Inspection":
      return <LuEye className={cn("text-indigo-500", className)} />;
  }
};

export const ReplenishmentSystemIcon = ({
  type,
  className
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
  className
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
  className
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

export const LinearIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="#717ce2"
      transform="matrix(1, 0, 0, 1, 0, 0)"
      className={props.className}
      {...props}
    >
      <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
      <g
        id="SVGRepo_tracerCarrier"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></g>
      <g id="SVGRepo_iconCarrier">
        {" "}
        <path
          d="M3.03509 12.9431C3.24245 14.9227 4.10472 16.8468 5.62188 18.364C7.13904 19.8811 9.0631 20.7434 11.0428 20.9508L3.03509 12.9431Z"
          fill="currentColor"
        ></path>{" "}
        <path
          d="M3 11.4938L12.4921 20.9858C13.2976 20.9407 14.0981 20.7879 14.8704 20.5273L3.4585 9.11548C3.19793 9.88771 3.0451 10.6883 3 11.4938Z"
          fill="currentColor"
        />{" "}
        <path
          d="M3.86722 8.10999L15.8758 20.1186C16.4988 19.8201 17.0946 19.4458 17.6493 18.9956L4.99021 6.33659C4.54006 6.89125 4.16573 7.487 3.86722 8.10999Z"
          fill="currentColor"
        />{" "}
        <path
          d="M5.66301 5.59517C9.18091 2.12137 14.8488 2.135 18.3498 5.63604C21.8508 9.13708 21.8645 14.8049 18.3907 18.3228L5.66301 5.59517Z"
          fill="currentColor"
        />{" "}
      </g>
    </svg>
  );
};

export const LinearIssueStateBadge = (props: {
  state: LinearIssue["state"];
  className?: string;
}) => {
  const status = mapLinearStatusToCarbonStatus(props.state.type);
  let className = props.className;

  let icon: React.ReactNode = (
    <LuCircleDashed className={cn("text-foreground", className)} />
  );

  switch (status) {
    case "Pending":
      icon = <LuCircleDashed className={cn("text-foreground", className)} />;
      break;
    case "Skipped":
      icon = <LuCircleX className={cn("text-muted-foreground", className)} />;
      break;
    case "Completed":
      icon = <LuCircleCheck className={cn("text-emerald-600", className)} />;
      break;
    case "In Progress":
      icon = <AlmostDoneIcon className={className} />;
      break;
  }

  return (
    <Badge variant={"secondary"} className="py-1 bg-transparent">
      {icon}
      <span className="ml-1">{props.state.name}</span>
    </Badge>
  );
};

export const JiraIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 65 65"
      fill="currentColor"
      className={props.className}
      {...props}
    >
      <defs>
        <linearGradient id="jira-gradient-1" x1="98.03%" y1="0.16%" x2="58.89%" y2="40.53%">
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
        <linearGradient id="jira-gradient-2" x1="100.17%" y1="0.05%" x2="55.99%" y2="44.23%">
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <path
        d="M62.75 30.02L35.58 2.85 32.5 0 12.77 19.73 1.25 31.25a1.69 1.69 0 0 0 0 2.39L20 52.11l12.5 12.5 19.73-19.73.62-.62 9.9-9.9a1.69 1.69 0 0 0 0-2.34zM32.5 42.15l-9.65-9.65 9.65-9.65 9.65 9.65z"
        fill="currentColor"
      />
      <path
        d="M32.5 22.85A13.85 13.85 0 0 1 32.4 3L12.65 22.77l9.85 9.85z"
        fill="url(#jira-gradient-1)"
      />
      <path
        d="M42.17 32.48L32.5 42.15a13.86 13.86 0 0 1 0 19.6l19.77-19.75z"
        fill="url(#jira-gradient-2)"
      />
    </svg>
  );
};

export const JiraIssueStatusBadge = (props: {
  status: { name: string; category: "new" | "indeterminate" | "done" };
  className?: string;
}) => {
  let className = props.className;

  let icon: React.ReactNode = (
    <LuCircleDashed className={cn("text-foreground", className)} />
  );

  switch (props.status.category) {
    case "new":
      icon = <LuCircleDashed className={cn("text-foreground", className)} />;
      break;
    case "indeterminate":
      icon = <AlmostDoneIcon className={className} />;
      break;
    case "done":
      icon = <LuCircleCheck className={cn("text-emerald-600", className)} />;
      break;
  }

  return (
    <Badge variant={"secondary"} className="py-1 bg-transparent">
      {icon}
      <span className="ml-1">{props.status.name}</span>
    </Badge>
  );
};
