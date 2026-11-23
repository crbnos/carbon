// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton, useViewport } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

/**
 * Phones: which one of a report's value columns shows. Starts on `initial`
 * (default: the last, i.e. the latest period) and stays in range when the
 * column count changes.
 */
function useColumnStep(count: number, initial = count - 1) {
  const [index, setIndex] = useState(Math.max(0, initial));
  // A new period range or column set starts again on its default column.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per column count only
  useEffect(() => {
    setIndex(Math.max(0, initial));
  }, [count]);
  return [
    Math.min(Math.max(0, index), Math.max(0, count - 1)),
    setIndex
  ] as const;
}

/**
 * Phones: the report's column header, one column at a time, with ‹ › to step
 * to the neighbouring column.
 */
function ColumnStepper({
  index,
  count,
  onChange,
  label,
  detail
}: {
  index: number;
  count: number;
  onChange: (index: number) => void;
  label: ReactNode;
  /** Under the label, e.g. "To Date". */
  detail?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-1">
      <IconButton
        aria-label={t`Previous column`}
        variant="ghost"
        size="lg"
        icon={<LuChevronLeft />}
        isDisabled={index <= 0}
        onClick={() => onChange(index - 1)}
      />
      <div
        aria-live="polite"
        className="flex min-w-0 flex-1 flex-col items-center justify-center text-center"
      >
        <span className="truncate text-sm font-medium text-foreground">
          {label}
        </span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      {count > 1 ? (
        <span className="sr-only">{t`Column ${index + 1} of ${count}`}</span>
      ) : null}
      <IconButton
        aria-label={t`Next column`}
        variant="ghost"
        size="lg"
        icon={<LuChevronRight />}
        isDisabled={index >= count - 1}
        onClick={() => onChange(index + 1)}
      />
    </div>
  );
}

/** A report's frame; on phones it fills what the filter rows above it leave. */
export const reportFrameClassName =
  "h-[calc(100dvh-var(--header-height)-61px)] w-full max-md:h-auto max-md:min-h-0 max-md:flex-1";

/**
 * Phones: one value column at a time, with `stepper` in place of the desktop
 * header. Desktop: no stepper, and the caller renders every column.
 */
export function useReportColumnStep({
  count,
  initial,
  label,
  detail
}: {
  count: number;
  initial?: number;
  label: (index: number) => ReactNode;
  detail?: (index: number) => ReactNode;
}) {
  const { isPhone } = useViewport();
  const [index, setIndex] = useColumnStep(count, initial);
  return {
    isPhone,
    index,
    estimatedRowHeight: () => (isPhone ? 44 : 36),
    stepper:
      isPhone && count > 0 ? (
        <ColumnStepper
          index={index}
          count={count}
          onChange={setIndex}
          label={label(index)}
          detail={detail?.(index)}
        />
      ) : null
  };
}
