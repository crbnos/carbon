// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  getLineMergeFields,
  getMergeFields,
  mergeToken
} from "@carbon/documents/template";
import {
  Button,
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
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { LuBraces } from "react-icons/lu";
import { useDocumentTemplate } from "./context";
import { useMergeFieldName } from "./mergeFieldNames";

type MergeField = ReturnType<typeof getMergeFields>[number];

/**
 * Keeps the fields whose name and group hold every word of the search, so
 * "return date" finds the dates in the Return group.
 */
export function filterMergeFields<T extends { label: string; group: string }>(
  fields: readonly T[],
  search: string,
  nameOf: (name: string) => string = (name) => name
): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return fields.filter((field) => {
    const text = `${nameOf(field.group)} ${nameOf(field.label)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * Searchable list of the document's merge fields. Inserting one hands the caller the
 * `{token}` snippet to splice into whatever it's editing.
 * `row` adds the variables of that table row, first, for a text printed per row.
 */
export function MergeFieldMenu({
  onInsert,
  label,
  variant = "ghost",
  row
}: {
  onInsert: (snippet: string) => void;
  label: string;
  variant?: "ghost" | "secondary";
  row?: string;
}) {
  const { t } = useLingui();
  const { documentType } = useDocumentTemplate();
  const [open, setOpen] = useState(false);
  const chosen = useRef<string | null>(null);
  const fields = [
    ...(row ? getLineMergeFields(documentType, row) : []),
    ...getMergeFields(documentType)
  ];
  if (fields.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          leftIcon={<LuBraces />}
          className={cn(
            "shrink-0",
            variant === "ghost" && "text-muted-foreground"
          )}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label || t`Insert value`}
        className="w-64 p-0"
        // Inserted once the list has closed: an open list keeps focus inside it,
        // so the field could not take the caret before this.
        onCloseAutoFocus={(e) => {
          if (chosen.current === null) return;
          e.preventDefault();
          onInsert(chosen.current);
          chosen.current = null;
        }}
      >
        <MergeFieldList
          fields={fields}
          onChoose={(field) => {
            chosen.current = mergeToken(field.token);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Lives inside the popup, so each opening starts with an empty search. */
function MergeFieldList({
  fields,
  onChoose
}: {
  fields: MergeField[];
  onChoose: (field: MergeField) => void;
}) {
  const { t } = useLingui();
  const fieldName = useMergeFieldName();
  const [search, setSearch] = useState("");
  const found = useMemo(
    () => filterMergeFields(fields, search, fieldName),
    [fields, search, fieldName]
  );
  const groups = [...new Set(found.map((f) => f.group))];

  return (
    <Command shouldFilter={false}>
      <CommandInput
        aria-label={t`Search values`}
        placeholder={t`Search values`}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-72">
        <CommandEmpty>{t`No values found`}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={fieldName(group)}>
            {found
              .filter((f) => f.group === group)
              .map((field) => (
                <CommandItem
                  key={field.token}
                  value={`${group} ${field.token}`}
                  onSelect={() => onChoose(field)}
                >
                  {fieldName(field.label)}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
