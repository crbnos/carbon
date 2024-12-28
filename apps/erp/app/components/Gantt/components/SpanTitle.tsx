import { Badge, cn } from "@carbon/react";
import { Fragment } from "react";
import { LuChevronRight } from "react-icons/lu";
import type { GantEventLevel, GantEventStyle, GanttEvent } from "../types";

type SpanTitleProps = {
  message: string;
  isError: boolean;
  style: GantEventStyle;
  level: GantEventLevel;
  isPartial: boolean;
  size: "small" | "large";
};

export function SpanTitle(event: SpanTitleProps) {
  return (
    <span
      className={cn(
        "flex items-center gap-x-2 overflow-x-hidden",
        eventTextClassName(event)
      )}
    >
      <span className="truncate">{event.message}</span>{" "}
      <SpanAccessory accessory={event.style.accessory} size={event.size} />
    </span>
  );
}

function SpanAccessory({
  accessory,
  size,
}: {
  accessory: GantEventStyle["accessory"];
  size: SpanTitleProps["size"];
}) {
  if (!accessory) {
    return null;
  }

  switch (accessory.style) {
    case "person": {
      return (
        <SpanBadgeAccessory
          accessory={accessory}
          className={cn(
            "overflow-x-hidden",
            size === "large" ? "text-sm" : "text-xs"
          )}
        />
      );
    }
    default: {
      return (
        <div className={cn("flex gap-1")}>
          {accessory.items.map((item, index) => (
            <span key={index} className={cn("inline-flex items-center gap-1")}>
              {item.text}
            </span>
          ))}
        </div>
      );
    }
  }
}

export function SpanBadgeAccessory({
  accessory,
  className,
}: {
  accessory: NonNullable<GantEventStyle["accessory"]>;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("inline-flex items-center gap-0.5 truncate ", className)}
    >
      {accessory.items.map((item, index) => (
        <Fragment key={index}>
          <span className={cn("truncate")}>{item.text}</span>
          {index < accessory.items.length - 1 && (
            <span className="text-muted-foreground">
              <LuChevronRight className="h-4 w-4" />
            </span>
          )}
        </Fragment>
      ))}
    </Badge>
  );
}

function eventTextClassName(
  event: Pick<SpanTitleProps, "isError" | "style" | "level">
) {
  switch (event.level) {
    case "TRACE": {
      return textClassNameForVariant(event.style.variant);
    }
    case "LOG":
    case "INFO":
    case "DEBUG": {
      return textClassNameForVariant(event.style.variant);
    }
    case "WARN": {
      return "text-orange-500";
    }
    case "ERROR": {
      return "text-red-500";
    }
    default: {
      return textClassNameForVariant(event.style.variant);
    }
  }
}

export function eventBackgroundClassName(
  event: Pick<
    GanttEvent["data"],
    "isError" | "style" | "level" | "isPartial" | "isCancelled"
  >
) {
  if (event.isError) {
    return "bg-red-500";
  }

  if (event.isCancelled) {
    return "bg-muted";
  }

  switch (event.level) {
    case "TRACE": {
      return backgroundClassNameForVariant(
        event.style.variant,
        event.isPartial
      );
    }
    case "LOG":
    case "INFO":
    case "DEBUG": {
      return backgroundClassNameForVariant(
        event.style.variant,
        event.isPartial
      );
    }
    case "WARN": {
      return "bg-orange-500";
    }
    case "ERROR": {
      return "bg-red-500";
    }
    default: {
      return backgroundClassNameForVariant(
        event.style.variant,
        event.isPartial
      );
    }
  }
}

function textClassNameForVariant(variant: GantEventStyle["variant"]) {
  switch (variant) {
    case "primary": {
      return "text-foreground";
    }
    default: {
      return "text-muted-foreground";
    }
  }
}

function backgroundClassNameForVariant(
  variant: GantEventStyle["variant"],
  isPartial: boolean
) {
  switch (variant) {
    case "primary": {
      if (isPartial) {
        return "bg-blue-500";
      }
      return "bg-emerald-500";
    }
    default: {
      return "bg-gray-500";
    }
  }
}
