import type {
  FieldBlock,
  LabelBarcodeBlock,
  LabelEntityIdBlock,
  LabelLogoBlock,
  LabelNamedBlock
} from "@carbon/documents/template";
import { DEFAULT_HEADER_OPTIONS } from "@carbon/documents/template";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { useUser } from "~/hooks";
import { ToggleRow } from "./configHelpers";
import { useDocumentTemplate } from "./context";
import { LogoCropper } from "./LogoCropper";
import { MergeFieldMenu } from "./MergeFieldMenu";
import { NumberRow } from "./NumberRow";
import { useHeaderConfig } from "./useHeaderConfig";

/**
 * A single authored line. With a `label` it's a key-value; without, plain text.
 * The value is a single-line string (ZPL-safe) and supports merge fields.
 */
export function FieldConfig({ block }: { block: FieldBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const insertField = (snippet: string) =>
    updateBlock(block.id, { value: (block.value ?? "") + snippet });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-label">Label (optional)</Label>
        <Input
          id="field-label"
          value={block.label ?? ""}
          onChange={(e) => updateBlock(block.id, { label: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="field-value">Value</Label>
          <MergeFieldMenu onInsert={insertField} label="Insert field" />
        </div>
        <Input
          id="field-value"
          value={block.value ?? ""}
          onChange={(e) => updateBlock(block.id, { value: e.target.value })}
        />
      </div>
    </div>
  );
}

const BARCODE_SYMBOLOGIES: { value: string; label: string }[] = [
  { value: "pdf417", label: "PDF417" },
  { value: "code128", label: "Code 128" },
  { value: "datamatrix", label: "Data Matrix" },
  { value: "qrcode", label: "QR Code" }
];

/** Symbology + value + height for a barcode block. */
export function LabelBarcodeConfig({ block }: { block: LabelBarcodeBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const insertField = (snippet: string) =>
    updateBlock(block.id, { value: (block.value ?? "") + snippet });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Type</Label>
        <Select
          value={block.symbology}
          onValueChange={(value) =>
            updateBlock(block.id, {
              symbology: value as LabelBarcodeBlock["symbology"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BARCODE_SYMBOLOGIES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="barcode-value">Value</Label>
          <MergeFieldMenu onInsert={insertField} label="Insert field" />
        </div>
        <Input
          id="barcode-value"
          value={block.value ?? ""}
          onChange={(e) => updateBlock(block.id, { value: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Placement</Label>
        <Select
          value={block.placement}
          onValueChange={(value) =>
            updateBlock(block.id, {
              placement: value as LabelBarcodeBlock["placement"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="right">Top-right</SelectItem>
            <SelectItem value="center">Centered</SelectItem>
            <SelectItem value="full">Full width</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <NumberRow
        label="Height (pt)"
        minValue={16}
        maxValue={300}
        value={block.height ?? 56}
        onChange={(v) => updateBlock(block.id, { height: v })}
      />
    </div>
  );
}

/**
 * The document header logo, edited inline (no dialog). Edits live in the editor
 * store (`headerConfig`), so the preview reflects them instantly and they
 * persist with the template on Save.
 */
export function HeaderLogoConfig() {
  const { company } = useUser();
  const { section, config, patch } = useHeaderConfig();

  if (!section) {
    return (
      <p className="text-xs text-muted-foreground">
        The header section isn't available yet — save the template first.
      </p>
    );
  }

  const variant = config.logoVariant ?? "mark";
  const src =
    variant === "icon"
      ? (company?.logoLightIcon ?? company?.logoLight)
      : (company?.logoLight ?? company?.logoLightIcon);

  return (
    <div className="flex flex-col gap-3">
      {!config.showLogo && (
        <p className="text-xs text-muted-foreground">
          Logo is hidden — turn it on with the eye toggle in the list.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label>Logo</Label>
        <Select
          value={variant}
          onValueChange={(value) =>
            // Switching source invalidates the crop aspect.
            patch({
              logoVariant: value as typeof config.logoVariant,
              logoCrop: undefined
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mark">Wordmark</SelectItem>
            <SelectItem value="icon">Mark</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {src ? (
        <LogoCropper
          src={src}
          crop={config.logoCrop}
          onChange={(crop) => patch({ logoCrop: crop })}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          No company logo set — upload one in company settings to crop it.
        </p>
      )}
      <NumberRow
        label="Height (pt)"
        minValue={16}
        maxValue={120}
        value={config.logoHeight ?? DEFAULT_HEADER_OPTIONS.logoHeight}
        onChange={(v) => patch({ logoHeight: v })}
      />
    </div>
  );
}

/** Company logo: B&W toggle + height. */
export function LabelLogoConfig({ block }: { block: LabelLogoBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const { company } = useUser();
  const variant = block.variant ?? "mark";
  const src =
    variant === "icon"
      ? (company?.logoLightIcon ?? company?.logoLight)
      : (company?.logoLight ?? company?.logoLightIcon);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Logo</Label>
        <Select
          value={variant}
          onValueChange={(value) =>
            // Switching source invalidates the old crop's aspect.
            updateBlock(block.id, {
              variant: value as LabelLogoBlock["variant"],
              crop: undefined
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mark">Wordmark</SelectItem>
            <SelectItem value="icon">Mark</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {src ? (
        <LogoCropper
          src={src}
          crop={block.crop}
          onChange={(crop) => updateBlock(block.id, { crop })}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          No company logo set — upload one in company settings to crop it.
        </p>
      )}
      <ToggleRow
        label="Print in black & white"
        checked={block.monochrome ?? false}
        onChange={(v) => updateBlock(block.id, { monochrome: v })}
      />
      <NumberRow
        label="Height (pt)"
        minValue={16}
        maxValue={160}
        value={block.height ?? 50}
        onChange={(v) => updateBlock(block.id, { height: v })}
      />
      <p className="text-xs text-muted-foreground">
        Label printers always print the logo in black & white.
      </p>
    </div>
  );
}

/** The identifier line: a single interpolated value (merge fields supported). */
export function LabelEntityIdConfig({ block }: { block: LabelEntityIdBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const insertField = (snippet: string) =>
    updateBlock(block.id, { value: (block.value ?? "") + snippet });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="identifier-value">Value</Label>
        <MergeFieldMenu onInsert={insertField} label="Insert field" />
      </div>
      <Input
        id="identifier-value"
        value={block.value ?? ""}
        onChange={(e) => updateBlock(block.id, { value: e.target.value })}
      />
    </div>
  );
}

const LABEL_FIELD_DEFAULT_NAME: Record<LabelNamedBlock["type"], string> = {
  labelRevision: "Rev",
  labelQuantity: "Qty",
  labelTracking: "S/N"
};

/** Edit the printed name (prefix before the value) of a built-in label field. */
export function LabelFieldNameConfig({ block }: { block: LabelNamedBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const placeholder = LABEL_FIELD_DEFAULT_NAME[block.type];

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="label-field-name">Field name</Label>
      <Input
        id="label-field-name"
        value={block.label ?? ""}
        placeholder={placeholder}
        onChange={(e) => updateBlock(block.id, { label: e.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        Printed before the value, e.g. “{block.label || placeholder}: …”.
      </p>
    </div>
  );
}
