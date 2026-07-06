import { Image, Text, View } from "@react-pdf/renderer";
import { generateBarcode } from "../../../qr/barcode";
import type {
  FieldBlock,
  LabelBarcodeBlock as LabelBarcodeBlockType,
  LabelEntityIdBlock as LabelEntityIdBlockType,
  LabelLogoBlock as LabelLogoBlockType,
  LabelNamedBlock
} from "../../../template";
import { interpolateString } from "../../../template";
import { LogoImage } from "../../components/LogoImage";
import { tw } from "./tw";
import type { LabelData } from "./types";

/**
 * A two-column field row: name column (fixed width, so rows align) + value.
 * With no name, the value spans the row (plain text).
 */
function LabelFieldRow({
  name,
  value,
  data
}: {
  name?: string;
  value: string;
  data: LabelData;
}) {
  if (!value) return null;
  const fontSize = `${data.descriptionFontSize}pt`;
  if (!name) {
    return <Text style={{ ...tw("mb-1"), fontSize }}>{value}</Text>;
  }
  return (
    <View style={tw("flex flex-row mb-1")}>
      <Text style={{ width: data.labelColWidth, fontSize }}>{name}:</Text>
      <Text style={{ flex: 1, fontSize }}>{value}</Text>
    </View>
  );
}

/** A single authored line: `label: value` (or just the value when no label). */
export function LabelFieldBlock({
  block,
  data
}: {
  block: FieldBlock;
  data: LabelData;
}) {
  return (
    <LabelFieldRow
      name={block.label || undefined}
      value={interpolateString(block.value ?? "", data.vars)}
      data={data}
    />
  );
}

/** Item ID — the bold label heading. */
export function LabelHeadingBlock({ data }: { data: LabelData }) {
  const { item, titleFontSize } = data;
  if (!item.itemId) return null;
  return (
    <Text
      style={{
        maxWidth: "100%",
        ...tw("mb-1"),
        fontWeight: "bold",
        fontSize: `${titleFontSize}pt`,
        lineHeight: 1.2
      }}
    >
      {item.itemId}
    </Text>
  );
}

/** Revision row. */
export function LabelRevisionBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  if (!data.item.revision) return null;
  return (
    <LabelFieldRow
      name={block.label || "Rev"}
      value={String(data.item.revision)}
      data={data}
    />
  );
}

/** Quantity row (serial/batch-tracked items only). */
export function LabelQuantityBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  if (!["Serial", "Batch"].includes(data.item.trackingType)) return null;
  return (
    <LabelFieldRow
      name={block.label || "Qty"}
      value={String(data.item.quantity ?? "")}
      data={data}
    />
  );
}

/** Serial / Batch number row. */
export function LabelTrackingBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  const { item } = data;
  if (!item.number) return null;
  const defaultName =
    item.trackingType === "Serial"
      ? "S/N"
      : item.trackingType === "Batch"
        ? "Batch"
        : null;
  if (!defaultName) return null;
  return (
    <LabelFieldRow
      name={block.label || defaultName}
      value={String(item.number)}
      data={data}
    />
  );
}

/** A human-readable identifier line (interpolated value), centered. */
export function LabelEntityIdBlock({
  block,
  data
}: {
  block: LabelEntityIdBlockType;
  data: LabelData;
}) {
  const value = interpolateString(block.value ?? "", data.vars);
  if (!value) return null;
  return (
    <Text
      style={{
        ...tw("mt-1 text-center"),
        fontSize: `${data.descriptionFontSize - 1}pt`,
        width: "100%",
        flexShrink: 0
      }}
    >
      {value}
    </Text>
  );
}

/**
 * The scannable code. `right` placement renders square (top-right, like the
 * old QR slot); `full` placement stretches full width (e.g. PDF417).
 */
export function LabelBarcodeBlock({
  block,
  data
}: {
  block: LabelBarcodeBlockType;
  data: LabelData;
}) {
  const value = interpolateString(block.value ?? "", data.vars);
  if (!value) return null;
  // 2D square codes scale by module (no height, or they distort); linear and
  // stacked codes take a bar/row height.
  const isSquare =
    block.symbology === "qrcode" || block.symbology === "datamatrix";
  const src = generateBarcode(
    value,
    block.symbology,
    isSquare ? { scale: 4 } : { height: block.symbology === "pdf417" ? 8 : 12 }
  );

  if (block.placement === "full") {
    // Scale to the label stock so a full-width code never crowds out the text
    // rows (which clip/overlap on short labels). ~32% of the cell height, capped.
    const height =
      block.height ?? Math.max(28, Math.min(64, data.labelHeightPt * 0.32));
    return (
      <View style={{ ...tw("w-full flex items-center mt-1"), flexShrink: 0 }}>
        <Image
          src={src}
          style={{ width: "100%", height, objectFit: "contain" }}
        />
      </View>
    );
  }

  const size = block.height ?? data.qrCodeSize;

  if (block.placement === "center") {
    // Centered square in its own full-width row (e.g. a QR-only small label).
    return (
      <View style={{ ...tw("w-full flex items-center mt-1"), flexShrink: 0 }}>
        <Image
          src={src}
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      </View>
    );
  }

  return (
    <View style={tw("flex items-center justify-center mb-1")}>
      <Image
        src={src}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    </View>
  );
}

/** The company logo (color, or the monochrome variant when toggled / for ZPL). */
export function LabelLogoBlock({
  block,
  data
}: {
  block: LabelLogoBlockType;
  data: LabelData;
}) {
  const light = data.company?.logoLight;
  const icon = data.company?.logoLightIcon;
  // `icon` variant prefers the square logo; `mark` prefers the full logo.
  const companyLogo =
    block.variant === "icon" ? (icon ?? light) : (light ?? icon);
  const src = block.monochrome
    ? (data.logo?.mono ?? data.logo?.color ?? companyLogo)
    : (data.logo?.color ?? companyLogo);
  if (!src) return null;
  return (
    <View style={tw("flex items-end mb-1")}>
      <LogoImage src={src} height={block.height ?? 50} crop={block.crop} />
    </View>
  );
}
