"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";

type TruncatedTooltipTextProps = {
  children: ReactNode;
  tooltip: ReactNode;
  className?: string;
  contentClassName?: string;
  enabled?: boolean;
};

const isTextTruncated = (element: HTMLElement) =>
  element.scrollWidth > element.clientWidth ||
  element.scrollHeight > element.clientHeight;

function TruncatedTooltipText({
  children,
  tooltip,
  className,
  contentClassName,
  enabled = true
}: TruncatedTooltipTextProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const measureTruncation = useCallback(() => {
    if (!enabled || !tooltip || !triggerRef.current) {
      setIsTruncated(false);
      return;
    }

    setIsTruncated(isTextTruncated(triggerRef.current));
  }, [enabled, tooltip]);

  useEffect(() => {
    measureTruncation();

    if (!triggerRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      measureTruncation();
    });

    observer.observe(triggerRef.current);

    return () => observer.disconnect();
  }, [measureTruncation]);

  if (!enabled || !tooltip) {
    return <span className={className}>{children}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={triggerRef}
          className={cn("min-w-0", className)}
          onMouseEnter={measureTruncation}
          onFocus={measureTruncation}
        >
          {children}
        </span>
      </TooltipTrigger>
      {isTruncated ? (
        <TooltipContent
          side="top"
          align="start"
          sideOffset={6}
          className={cn(
            "max-w-[min(560px,calc(100vw-2rem))] whitespace-normal break-words border-border/80 bg-card/95 text-card-foreground shadow-xl backdrop-blur-sm",
            contentClassName
          )}
        >
          {tooltip}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

export { TruncatedTooltipText };
