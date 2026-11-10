// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  BsExclamationSquareFill,
  BsFileEarmarkFill,
  BsFileEarmarkPlayFill,
  BsFileExcelFill,
  BsFileImageFill,
  BsFilePdfFill,
  BsFilePptFill,
  BsFileTextFill,
  BsFileWordFill,
  BsFileZipFill
} from "react-icons/bs";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuAtom,
  LuBarcode,
  LuBox,
  LuCircleCheck,
  LuCircleX,
  LuClipboardCheck,
  LuClock,
  LuEye,
  LuFlaskConical,
  LuGroup,
  LuHammer,
  LuHeadphones,
  LuHexagon,
  LuImage,
  LuList,
  LuPizza,
  LuQrCode,
  LuShoppingCart,
  LuSquare,
  LuToggleLeft,
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetOff } from "react-icons/tb";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { documentTypes } from "~/services/models";
import type { Operation } from "~/services/types";

type FileIconProps = {
  type: (typeof documentTypes)[number];
  className?: string;
};

const documentIconBaseClase = "w-6 h-6 flex-shrink-0";

export function DeadlineIcon({
  deadlineType,
  overdue
}: {
  deadlineType: Operation["jobDeadlineType"];
  overdue: boolean;
}) {
  const { t } = useLingui();
  // Every call site follows the icon with text: the deadline type itself for
  // ASAP / No Deadline (so the icon is decorative), the due date otherwise —
  // then the icon is the only place the hard/soft priority shows, so name it.
  const named = (icon: ReactNode, label: string) => (
    <span
      className="inline-flex"
      role="img"
      aria-label={overdue ? t`${label}, overdue` : label}
    >
      {icon}
    </span>
  );
  switch (deadlineType) {
    case "ASAP":
      return (
        <BsExclamationSquareFill aria-hidden="true" className="text-red-500" />
      );
    case "Hard Deadline":
      return named(
        <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />,
        t`Hard deadline`
      );
    case "Soft Deadline":
      return named(
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />,
        t`Soft deadline`
      );
    case "No Deadline":
      return (
        <span className="inline-flex" aria-hidden="true">
          <LowPriorityIcon />
        </span>
      );
    default:
      return null;
  }
}

export const FileIcon = ({ type, className }: FileIconProps) => {
  switch (type) {
    case "Document":
      return (
        <BsFileWordFill
          className={cn(documentIconBaseClase, "text-blue-500", className)}
        />
      );
    case "Spreadsheet":
      return (
        <BsFileExcelFill
          className={cn(documentIconBaseClase, "text-emerald-700", className)}
        />
      );
    case "Presentation":
      return (
        <BsFilePptFill
          className={cn(documentIconBaseClase, "text-orange-400", className)}
        />
      );
    case "PDF":
      return (
        <BsFilePdfFill
          className={cn(documentIconBaseClase, "text-red-600", className)}
        />
      );
    case "Archive":
      return <BsFileZipFill className={cn(documentIconBaseClase, className)} />;
    case "Text":
      return (
        <BsFileTextFill className={cn(documentIconBaseClase, className)} />
      );
    case "Image":
      return (
        <BsFileImageFill
          className={cn(documentIconBaseClase, "text-yellow-400", className)}
        />
      );
    case "Video":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClase, "text-purple-500", className)}
        />
      );
    case "Audio":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClase, "text-cyan-400", className)}
        />
      );
    case "Other":
    default:
      return (
        <BsFileEarmarkFill className={cn(documentIconBaseClase, className)} />
      );
  }
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
    case "Purchase to Order":
      return <LuShoppingCart className={cn("text-blue-500", className)} />;
    case "Make to Order":
      return isKit ? (
        <LuHexagon className={cn("text-emerald-500", className)} />
      ) : (
        <RxCodesandboxLogo className={cn("text-emerald-500", className)} />
      );
    case "Pull from Inventory":
      return <FaCodePullRequest className={cn("text-yellow-500", className)} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
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

export function OperationStatusIcon({
  status
}: {
  status: Operation["operationStatus"];
}) {
  const getIcon = () => {
    switch (status) {
      case "Todo":
        return <TodoStatusIcon className="text-foreground" />;
      case "Ready":
        return <TodoStatusIcon className="text-blue-600" />;
      case "Waiting":
      case "Canceled":
        return <LuCircleX className="text-red-600" />;
      case "Done":
        return <LuCircleCheck className="text-green-600" />;
      case "In Progress":
        return <AlmostDoneIcon />;
      case "Paused":
        return <InProgressStatusIcon />;
      default:
        return null;
    }
  };

  const icon = getIcon();
  if (!icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" role="img" aria-label={status}>
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
}

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
      return <LuImage className={cn("text-purple-500", className)} />;
    case "Inspection":
      return <LuEye className={cn("text-indigo-500", className)} />;
  }
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
