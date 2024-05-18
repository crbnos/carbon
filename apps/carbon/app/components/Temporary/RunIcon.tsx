import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  HiClock,
  HiHandRaised,
  HiInformationCircle,
  HiSquares2X2,
} from "react-icons/hi2";
import { LuCalendarClock, LuClock } from "react-icons/lu";
import { AttemptIcon } from "~/assets/icons/AttemptIcon";
import { TaskIcon } from "~/assets/icons/TaskIcon";

type TaskIconProps = {
  name: string | undefined;
  className?: string;
};

export function RunIcon({ name, className }: TaskIconProps) {
  if (!name)
    return <HiSquares2X2 className={cn(className, "text-muted-foreground")} />;

  switch (name) {
    case "job":
      return <LuCalendarClock className={cn(className, "text-primary")} />;
    case "assembly":
      return (
        <AiOutlinePartition className={cn(className, "text-indigo-500")} />
      );
    case "operation":
      return <LuClock className={cn(className, "text-blue-500")} />;
    case "timecard":
      return <TaskIcon className={cn(className, "text-yellow-500")} />;
    case "attempt":
      return <AttemptIcon className={cn(className, "text-muted-foreground")} />;
    case "wait":
      return <HiClock className={cn(className, "text-teal-500")} />;
    case "trace":
      return (
        <HiSquares2X2 className={cn(className, "text-muted-foreground")} />
      );
    //log levels
    case "debug":
    case "log":
    case "info":
      return (
        <HiInformationCircle
          className={cn(className, "text-muted-foreground")}
        />
      );
    case "warn":
      return (
        <HiInformationCircle className={cn(className, "text-amber-400")} />
      );
    case "error":
      return <HiInformationCircle className={cn(className, "text-rose-500")} />;
    case "fatal":
      return <HiHandRaised className={cn(className, "text-rose-800")} />;
  }

  return <HiSquares2X2 className={cn(className, "text-muted-foreground")} />;
}
