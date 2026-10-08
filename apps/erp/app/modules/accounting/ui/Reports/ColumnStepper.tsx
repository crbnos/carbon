// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

/**
 * Phones: which one of a report's value columns shows. Starts on `initial`
 * (default: the last, i.e. the latest period) and stays in range when the
 * column count changes.
 */
export function useColumnStep(count: number, initial = count - 1) {
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
export function ColumnStepper({
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
