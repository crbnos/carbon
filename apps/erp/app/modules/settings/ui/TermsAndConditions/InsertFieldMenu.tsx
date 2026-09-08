import type { MergeField } from "@carbon/documents/template";
import { mergeToken } from "@carbon/documents/template";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Fragment } from "react";
import { LuBraces } from "react-icons/lu";

/**
 * Merge fields insertable into a terms version. A version belongs to exactly
 * one document type, so it gets that document's full field set — an inserted
 * token always resolves when the document prints.
 */
export function InsertFieldMenu({
  fields,
  onInsert
}: {
  fields: MergeField[];
  onInsert: (snippet: string) => void;
}) {
  if (fields.length === 0) return null;
  const groups = [...new Set(fields.map((field) => field.group))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuBraces />}
          className="shrink-0"
        >
          <Trans>Insert field</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {groups.map((group) => (
          <Fragment key={group}>
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {fields
              .filter((field) => field.group === group)
              .map((field) => (
                <DropdownMenuItem
                  key={field.token}
                  onClick={() => onInsert(mergeToken(field.token))}
                >
                  {field.label}
                </DropdownMenuItem>
              ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default InsertFieldMenu;
