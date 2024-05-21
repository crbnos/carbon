import {
  Button,
  Card,
  CardContent,
  CardHeader,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import { BsExclamationSquareFill } from "react-icons/bs";
import {
  LuCalendarCheck,
  LuFactory,
  LuGripVertical,
  LuRocket,
  LuUsers,
} from "react-icons/lu";

import CustomerAvatar from "~/components/CustomerAvatar";
import EmployeeAvatarGroup from "~/components/EmployeeAvatarGroup";
import type { Item, ItemDragData } from "../types";
import KanbanStatus from "./KanbanStatus";

type ItemCardProps = {
  item: Item;
  isOverlay?: boolean;
};

export function ItemCard({ item, isOverlay }: ItemCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: "item",
      item,
    } satisfies ItemDragData,
    attributes: {
      roleDescription: "item",
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const variants = cva("", {
    variants: {
      dragging: {
        over: "ring-2 opacity-30",
        overlay: "ring-2 ring-primary",
      },
    },
  });

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px]",
        variants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
        })
      )}
    >
      <CardHeader className="max-w-full px-3 py-3 space-y-0 flex-row border-b-2 border-secondary relative">
        <span className="mr-auto font-semibold truncate">{item.title}</span>
        <Button
          variant={"ghost"}
          {...attributes}
          {...listeners}
          className="p-1 text-secondary-foreground/50 -ml-2 h-auto cursor-grab"
        >
          <span className="sr-only">Move item</span>
          <LuGripVertical />
        </Button>
      </CardHeader>
      <CardContent className="p-3 space-y-2 text-left whitespace-pre-wrap">
        {item.status && (
          <HStack className="justify-start space-x-2">
            <LuRocket className="text-muted-foreground" />
            <KanbanStatus {...item.status} />
          </HStack>
        )}
        {item.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(item.deadlineType)}
            <Tooltip>
              <TooltipTrigger>
                <span className="text-sm">
                  {["ASAP", "NO_DEADLINE"].includes(item.deadlineType)
                    ? getDeadlineText(item.deadlineType)
                    : formatDate(item.dueDate)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {getDeadlineText(item.deadlineType)}
              </TooltipContent>
            </Tooltip>
          </HStack>
        )}

        {item.customerId && (
          <HStack className="justify-start space-x-2">
            <LuFactory className="text-muted-foreground" />
            <CustomerAvatar customerId={item.customerId} />
          </HStack>
        )}

        {item.employeeIds && (
          <HStack className="justify-start space-x-2">
            <LuUsers className="text-muted-foreground" />
            <EmployeeAvatarGroup employeeIds={item.employeeIds} />
          </HStack>
        )}
      </CardContent>
    </Card>
  );
}

function getDeadlineIcon(deadlineType: Item["deadlineType"]) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "HARD_DEADLINE":
      return <LuCalendarCheck className="text-orange-500" />;
    case "SOFT_DEADLINE":
      return <LuCalendarCheck className="text-yellow-500" />;
    case "NO_DEADLINE":
      return <LuCalendarCheck className="text-muted-foreground" />;
  }
}

function getDeadlineText(deadlineType: Item["deadlineType"]) {
  switch (deadlineType) {
    case "ASAP":
      return "ASAP";
    case "HARD_DEADLINE":
      return "Hard deadline";
    case "SOFT_DEADLINE":
      return "Soft deadline";
    case "NO_DEADLINE":
      return "No deadline";
  }
}
