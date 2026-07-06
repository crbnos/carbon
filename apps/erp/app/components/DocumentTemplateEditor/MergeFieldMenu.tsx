import { getMergeFields, mergeToken } from "@carbon/documents/template";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@carbon/react";
import { Fragment } from "react";
import { LuBraces } from "react-icons/lu";
import { useDocumentTemplate } from "./context";

/**
 * Dropdown of the document's merge fields. Inserting one hands the caller the
 * `{token}` snippet to splice into whatever it's editing (a key-value cell,
 * rich text, etc.).
 */
export function MergeFieldMenu({
  onInsert,
  label = "Field"
}: {
  onInsert: (snippet: string) => void;
  label?: string;
}) {
  const { documentType } = useDocumentTemplate();
  const fields = getMergeFields(documentType);
  if (fields.length === 0) return null;

  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuBraces />}
          className="shrink-0 text-muted-foreground"
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {groups.map((group) => (
          <Fragment key={group}>
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {fields
              .filter((f) => f.group === group)
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
