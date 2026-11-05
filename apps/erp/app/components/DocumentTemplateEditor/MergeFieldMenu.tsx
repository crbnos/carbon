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
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@carbon/react";
import { Fragment, useRef } from "react";
import { LuBraces } from "react-icons/lu";
import { useDocumentTemplate } from "./context";
import { useMergeFieldName } from "./mergeFieldNames";

/**
 * Dropdown of the document's merge fields. Inserting one hands the caller the
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
  const { documentType } = useDocumentTemplate();
  const fieldName = useMergeFieldName();
  const chosen = useRef<string | null>(null);
  const fields = [
    ...(row ? getLineMergeFields(documentType, row) : []),
    ...getMergeFields(documentType)
  ];
  if (fields.length === 0) return null;

  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 overflow-y-auto"
        // Inserted once the menu has closed: an open menu keeps focus inside it,
        // so the field could not take the caret before this.
        onCloseAutoFocus={(e) => {
          if (chosen.current === null) return;
          e.preventDefault();
          onInsert(chosen.current);
          chosen.current = null;
        }}
      >
        {groups.map((group) => (
          <Fragment key={group}>
            <DropdownMenuLabel>{fieldName(group)}</DropdownMenuLabel>
            {fields
              .filter((f) => f.group === group)
              .map((field) => (
                <DropdownMenuItem
                  key={field.token}
                  onClick={() => {
                    chosen.current = mergeToken(field.token);
                  }}
                >
                  {fieldName(field.label)}
                </DropdownMenuItem>
              ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
