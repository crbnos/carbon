import type { DocumentTheme } from "@carbon/documents/template";
import { documentThemeColors } from "@carbon/documents/template";
import { ColorPicker } from "~/components/ColorPicker";
import { useEditorStore } from "./context";

const SWATCHES: Record<keyof DocumentTheme, { label: string; hint: string }> = {
  accent: { label: "Accent", hint: "Line-items header bar" },
  accentForeground: { label: "Accent text", hint: "Text on the accent bar" },
  heading: { label: "Headings", hint: "Section titles (BILL TO, NOTES…)" },
  text: { label: "Body text", hint: "Addresses, values, item details" }
};

export function ThemeConfig() {
  const documentType = useEditorStore((s) => s.documentType);
  const theme = useEditorStore((s) => s.theme);
  const setThemeColor = useEditorStore((s) => s.setThemeColor);
  const keys = documentThemeColors(documentType);

  if (keys.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {keys.map((key) => (
        <div key={key} className="flex flex-col gap-1.5">
          <div className="flex flex-col">
            <span className="text-sm">{SWATCHES[key].label}</span>
            <span className="text-xs text-muted-foreground">
              {SWATCHES[key].hint}
            </span>
          </div>
          <ColorPicker
            value={theme[key]}
            onChange={(value) => setThemeColor(key, value)}
          />
        </div>
      ))}
    </div>
  );
}

/** Whether any theme color applies to this document (gates the Colors tab). */
export function hasThemeColors(
  documentType: Parameters<typeof documentThemeColors>[0]
): boolean {
  return documentThemeColors(documentType).length > 0;
}
