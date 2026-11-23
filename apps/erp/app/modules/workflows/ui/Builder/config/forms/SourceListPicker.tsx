// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AvailableVariable } from "@carbon/ee/workflows";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { describeValueType } from "../../catalog";
import { Section } from "../layout";

type SourceListPickerProps = {
  /** Whether the node holds a source at all — it can outlive the variable it named. */
  hasSource: boolean;
  /** The upstream variable the source points at, when it still exists. */
  sourceVar: AvailableVariable | undefined;
  listVars: AvailableVariable[];
  isReadOnly?: boolean;
  onSelect: (nodeId: string, output: string) => void;
  onClear: () => void;
};

/** The chain's one source list. Rendered inside the first card, which owns it. */
export function SourceListPicker({
  hasSource,
  sourceVar,
  listVars,
  isReadOnly,
  onSelect,
  onClear
}: SourceListPickerProps) {
  const { t } = useLingui();
  const [sourceOpen, setSourceOpen] = useState(false);

  return (
    <div className="space-y-1">
      <Section>
        <Trans>Source list</Trans>
      </Section>

      <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isReadOnly}
            className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn("truncate", !hasSource && "text-muted-foreground")}
            >
              {sourceVar
                ? `${sourceVar.nodeName} › ${sourceVar.output}`
                : t`Pick a list variable…`}
            </span>
            <LuChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <Command>
            <CommandInput
              placeholder={t`Search list variables…`}
              disabled={isReadOnly}
            />
            <CommandList className="max-h-64 overflow-y-auto">
              <CommandEmpty>
                <Trans>No list variables available upstream.</Trans>
              </CommandEmpty>
              <CommandGroup>
                {listVars.map((v) => (
                  <CommandItem
                    key={`${v.nodeId}:${v.output}`}
                    value={`${v.nodeName} ${v.output} ${describeValueType(v.type)}`}
                    disabled={isReadOnly}
                    onSelect={() => {
                      onSelect(v.nodeId, v.output);
                      setSourceOpen(false);
                    }}
                    className="flex flex-col items-start gap-0.5 px-3 py-2"
                  >
                    <span className="text-sm font-medium">{v.output}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.nodeName} · {describeValueType(v.type)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {hasSource && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          onClick={onClear}
          disabled={isReadOnly}
        >
          <Trans>Clear</Trans>
        </button>
      )}
    </div>
  );
}
