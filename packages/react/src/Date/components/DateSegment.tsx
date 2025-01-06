import { useDateSegment } from "@react-aria/datepicker";
import type {
  DateSegment as DateSegmentType,
  useDateFieldState,
} from "@react-stately/datepicker";
import clsx from "clsx";
import { useId, useRef } from "react";

const segmentSizeVariants = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
} as const;

interface DateSegmentProps {
  segment: DateSegmentType;
  state: ReturnType<typeof useDateFieldState>;
  size?: keyof typeof segmentSizeVariants;
}

export const DateSegment = ({
  segment,
  state,
  size = "md",
}: DateSegmentProps) => {
  const instanceId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { segmentProps } = useDateSegment(segment, state, ref);

  if ("id" in segmentProps && segmentProps.id) {
    segmentProps.id = instanceId;
  }
  if ("aria-describedby" in segmentProps && segmentProps["aria-describedby"]) {
    segmentProps["aria-describedby"] = instanceId;
  }

  return (
    <div
      {...segmentProps}
      ref={ref}
      className={clsx(
        "box-content tabular-nums text-right outline-none rounded-sm group focus:bg-primary focus:text-primary-foreground",
        segmentSizeVariants[size]
      )}
    >
      <span
        aria-hidden="true"
        className={clsx("w-full text-center", {
          hidden: !segment.isPlaceholder,
          "h-0": !segment.isPlaceholder,
          block: segment.isPlaceholder,
        })}
      >
        {segment.isPlaceholder
          ? segment.text.toUpperCase()
          : segment.placeholder}
      </span>
      {segment.isPlaceholder ? "" : segment.text}
    </div>
  );
};
