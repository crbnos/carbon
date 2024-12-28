import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuCalendarClock,
  LuClock,
  LuFlaskConical,
  LuHand,
  LuInfo,
  LuSquare,
} from "react-icons/lu";
import { AttemptIcon } from "~/assets/icons/AttemptIcon";
import { TaskIcon } from "~/assets/icons/TaskIcon";

type TaskIconProps = {
  name: string | undefined;
  className?: string;
};

export function GanttIcon({ name, className }: TaskIconProps) {
  if (!name)
    return <LuSquare className={cn(className, "text-muted-foreground")} />;

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
    case "inspection":
      return <LuFlaskConical className={cn(className, "text-teal-500")} />;
    case "attempt":
      return <AttemptIcon className={cn(className, "text-muted-foreground")} />;
    case "wait":
      return <LuClock className={cn(className, "text-yellow-500")} />;
    //log levels
    case "debug":
    case "log":
    case "info":
      return <LuInfo className={cn(className, "text-muted-foreground")} />;
    case "warn":
      return <LuInfo className={cn(className, "text-amber-400")} />;
    case "error":
      return <LuInfo className={cn(className, "text-rose-500")} />;
    case "fatal":
      return <LuHand className={cn(className, "text-rose-800")} />;
  }

  return <LuSquare className={cn(className, "text-muted-foreground")} />;
}
