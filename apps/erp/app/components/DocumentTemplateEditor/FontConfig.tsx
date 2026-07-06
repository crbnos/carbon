import { DOCUMENT_FONTS } from "@carbon/documents/template";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { useDocumentTemplate } from "./context";

/** Document body font selector (applies to the whole document). */
export function FontConfig() {
  const { settings, setSetting } = useDocumentTemplate();

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Body font</Label>
      <Select
        value={settings.fontFamily}
        onValueChange={(v) =>
          setSetting("fontFamily", v as typeof settings.fontFamily)
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DOCUMENT_FONTS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              <span className="flex w-full items-center justify-between gap-3">
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">{f.kind}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Applies to the whole document.
      </p>
    </div>
  );
}
