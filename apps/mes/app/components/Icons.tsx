import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuAtom,
  LuCheckCircle,
  LuHammer,
  LuHeadphones,
  LuPizza,
  LuShoppingCart,
  LuSquare,
  LuXCircle,
} from "react-icons/lu";

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
  BsFileZipFill,
} from "react-icons/bs";
import { RxCodesandboxLogo } from "react-icons/rx";
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
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Method":
      return (
        <AiOutlinePartition className={cn(className, "text-foreground")} />
      );
    case "Buy":
      return <LuShoppingCart className={cn("text-blue-500", className)} />;
    case "Make":
      return (
        <RxCodesandboxLogo className={cn("text-emerald-500", className)} />
      );
    case "Pick":
      return <FaCodePullRequest className={cn("text-yellow-500", className)} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
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

export function OperationStatusIcon({
  status,
}: {
  status: Operation["operationStatus"];
}) {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className="text-foreground" />;
    case "Waiting":
    case "Canceled":
      return <LuXCircle className="text-muted-foreground" />;
    case "Done":
      return <LuCheckCircle className="text-blue-600" />;
    case "In Progress":
      return <AlmostDoneIcon />;
    case "Paused":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}

export function DeadlineIcon({
  deadlineType,
  overdue,
}: {
  deadlineType: Operation["jobDeadlineType"];
  overdue: boolean;
}) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "Hard Deadline":
      return <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />;
    case "Soft Deadline":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />
      );
    case "No Deadline":
      return <LowPriorityIcon />;
    default:
      return null;
  }
}
