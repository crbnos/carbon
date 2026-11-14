// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import { generateHTML } from "./HTML";
import { Tabs, TabsList, TabsTrigger } from "./Tabs";
import { cn } from "./utils/cn";

/**
 * The plan panes an inspection lot shows beside its measurement grid: the
 * plan's parameters (setup the inspector reads before measuring) and its work
 * instructions. The ERP grid and the MES matrix both render these.
 */

/** A plan parameter: setup the inspector reads before measuring. */
export type InspectionParameter = { id: string; key: string; value: string };

export type InspectionPlanTab =
  | "characteristics"
  | "parameters"
  | "instructions";

/** A document with nothing but empty paragraphs has no instructions to read. */
export function hasWorkInstruction(doc: JSONContent | null | undefined) {
  return (doc?.content ?? []).some(
    (node) => node.type !== "paragraph" || (node.content?.length ?? 0) > 0
  );
}

/** Characteristics | Parameters | Instructions. */
export function InspectionPlanTabs({
  value,
  onValueChange,
  characteristicsLabel,
  className
}: {
  value: InspectionPlanTab;
  onValueChange: (value: InspectionPlanTab) => void;
  characteristicsLabel: ReactNode;
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as InspectionPlanTab)}
    >
      <TabsList className={className}>
        <TabsTrigger value="characteristics">
          {characteristicsLabel}
        </TabsTrigger>
        <TabsTrigger value="parameters">{t`Parameters`}</TabsTrigger>
        <TabsTrigger value="instructions">{t`Instructions`}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

type PaneSize = "md" | "lg";

function EmptyPane({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The plan's parameters as a key/value list. `lg` (the shop floor) shows a
 * short value large enough to read from arm's length.
 */
export function InspectionPlanParameters({
  parameters,
  size = "md",
  className
}: {
  parameters: InspectionParameter[];
  size?: PaneSize;
  className?: string;
}) {
  const { t } = useLingui();
  if (parameters.length === 0) {
    return (
      <EmptyPane className={className}>
        {t`This inspection plan has no parameters.`}
      </EmptyPane>
    );
  }
  return (
    <dl
      className={cn(
        "min-h-0 flex-1 divide-y divide-border overflow-auto",
        className
      )}
    >
      {parameters.map((parameter) => (
        <div
          key={parameter.id}
          className={cn(
            "flex justify-between gap-4 px-4",
            size === "lg"
              ? "min-h-14 items-center py-2"
              : "items-baseline py-2.5"
          )}
        >
          <dt className="text-sm text-muted-foreground">{parameter.key}</dt>
          <dd
            className={cn(
              "text-right",
              size === "lg"
                ? cn(
                    "text-foreground",
                    parameter.value.length > 8
                      ? "text-sm font-medium"
                      : "text-xl font-semibold tabular-nums tracking-tight"
                  )
                : "text-sm font-medium tabular-nums"
            )}
          >
            {parameter.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The plan's work instructions (Tiptap JSON) rendered read-only. `lg` (the
 * shop floor) fits each image to the screen.
 */
export function InspectionPlanInstructions({
  workInstruction,
  size = "md",
  className
}: {
  workInstruction: JSONContent | null | undefined;
  size?: PaneSize;
  className?: string;
}) {
  const { t } = useLingui();
  if (!hasWorkInstruction(workInstruction)) {
    return (
      <EmptyPane className={className}>
        {t`This inspection plan has no work instructions.`}
      </EmptyPane>
    );
  }
  return (
    <div className={cn("min-h-0 flex-1 overflow-auto p-4", className)}>
      <div
        className={cn(
          "prose max-w-none dark:prose-invert",
          size === "lg" &&
            "[&_img]:max-h-[65vh] [&_img]:w-full [&_img]:object-contain"
        )}
        dangerouslySetInnerHTML={{
          __html: generateHTML(workInstruction as JSONContent)
        }}
      />
    </div>
  );
}
