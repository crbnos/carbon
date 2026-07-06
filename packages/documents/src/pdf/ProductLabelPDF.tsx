import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { Document, Page, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import { createTw } from "react-pdf-tailwind";
import type { DocumentTemplate, ResolvedSection } from "../template";
import { resolveTemplate } from "../template";
import type { Company } from "../types";
import type { LabelData, LabelLogo } from "./blocks/trackingLabel";
import {
  buildLabelVars,
  trackingLabelBlockRegistry
} from "./blocks/trackingLabel";
import { getLabelPdfGeometry } from "./components/labelGeometry";

interface ProductLabelProps {
  items: ProductLabelItem[];
  labelSize: LabelSize;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
  company?: Company | null;
  logo?: LabelLogo | null;
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d"
        }
      }
    }
  }
});

const ProductLabelPDF = ({
  items,
  labelSize,
  template,
  sections = {},
  company,
  logo
}: ProductLabelProps) => {
  // Default to 1 row and 1 column if not specified
  const rows = labelSize.rows || 1;
  const columns = labelSize.columns || 1;
  const rotated = labelSize.rotated || false;

  const resolved = resolveTemplate("trackingLabel", template ?? null);
  const visibleBlocks = resolved.blocks.filter((block) => block.visible);

  // Standard letter size paper (8.5 x 11 inches in points)
  const LETTER_WIDTH = 8.5 * 72;
  const LETTER_HEIGHT = 11 * 72;

  // Calculate dimensions in points (72 points per inch)
  const labelWidthPt = labelSize.width * 72;
  const labelHeightPt = labelSize.height * 72;

  // Account for rotation when calculating effective dimensions
  const effectiveLabelWidthPt = rotated ? labelHeightPt : labelWidthPt;
  const effectiveLabelHeightPt = rotated ? labelWidthPt : labelHeightPt;

  // A single label prints on a page sized exactly to the label, with no
  // margins, so it feeds correctly on a thermal/label printer. Multi-up sheets
  // (rows × columns, e.g. Avery) print on a standard letter sheet with the
  // grid centred.
  const isMultiUp = rows > 1 || columns > 1;
  const pageWidth = isMultiUp ? LETTER_WIDTH : effectiveLabelWidthPt;
  const pageHeight = isMultiUp ? LETTER_HEIGHT : effectiveLabelHeightPt;

  // Font + QR sizing comes from the shared label geometry (203dpi, 2"x1"
  // baseline, unit-matched to the ZPL output) so the PDF and ZPL prints look
  // alike and scale continuously across stock sizes.
  const geometry = getLabelPdfGeometry(labelSize);
  const titleFontSize = geometry.titleFontSize;
  const descriptionFontSize = geometry.descFontSize;
  const qrCodeSize = geometry.qrSize;

  // Calculate how many pages we need
  const labelsPerPage = rows * columns;
  const pageCount = Math.ceil(items.length / labelsPerPage);

  // Labels never carry a footer (no page numbers / registration line) — every
  // millimetre of the stock is for the label content. Multi-up sheets centre
  // their grid on the letter page; a single label fills its label-sized page
  // edge-to-edge (no margins).
  const horizontalMargin = isMultiUp
    ? (pageWidth - columns * effectiveLabelWidthPt) / 2
    : 0;
  const verticalMargin = isMultiUp
    ? (pageHeight - rows * effectiveLabelHeightPt) / 2
    : 0;

  return (
    <Document>
      {Array.from({ length: pageCount }).map((_, pageIndex) => (
        <Page key={pageIndex} size={[pageWidth, pageHeight]} style={tw("p-0")}>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <View
              key={`row-${rowIndex}`}
              style={{
                flexDirection: "row",
                marginLeft: horizontalMargin,
                marginTop: rowIndex === 0 ? verticalMargin : 0
              }}
            >
              {Array.from({ length: columns }).map((_, colIndex) => {
                const itemIndex =
                  pageIndex * labelsPerPage + rowIndex * columns + colIndex;
                const item = items[itemIndex];

                if (!item)
                  return (
                    <View
                      key={`empty-${colIndex}`}
                      style={{ width: labelWidthPt, height: labelHeightPt }}
                    />
                  );

                const data: LabelData = {
                  item,
                  company,
                  logo,
                  theme: resolved.theme,
                  vars: buildLabelVars(item, company),
                  titleFontSize,
                  descriptionFontSize,
                  qrCodeSize,
                  labelColWidth: labelWidthPt * 0.26,
                  labelHeightPt: effectiveLabelHeightPt,
                  sections
                };

                const renderBlock = (block: (typeof visibleBlocks)[number]) => {
                  const render = trackingLabelBlockRegistry[block.type];
                  if (!render) return null;
                  return (
                    <Fragment key={block.id}>
                      {render({ block, data })}
                    </Fragment>
                  );
                };

                // Slots: fields stack top-left; logo + "right" codes top-right;
                // "full" codes span full width near the bottom; entity id at the
                // very bottom.
                const rightBlocks = visibleBlocks.filter(
                  (b) =>
                    b.type === "labelLogo" ||
                    (b.type === "labelBarcode" && b.placement === "right")
                );
                const barcodeBlocks = visibleBlocks.filter(
                  (b) =>
                    b.type === "labelBarcode" &&
                    (b.placement === "full" || b.placement === "center")
                );
                const entityBlocks = visibleBlocks.filter(
                  (b) => b.type === "labelEntityId"
                );
                const textBlocks = visibleBlocks.filter(
                  (b) =>
                    b.type !== "labelLogo" &&
                    b.type !== "labelBarcode" &&
                    b.type !== "labelEntityId"
                );

                return (
                  <View
                    key={`label-${itemIndex}`}
                    style={{
                      ...tw("relative p-2 flex flex-col pl-[10pt]"),
                      width: labelWidthPt,
                      height: labelHeightPt,
                      // Clip so a dense label's content can't bleed into the
                      // neighbouring cell (which clipped the next heading).
                      overflow: "hidden",
                      transform: rotated ? "rotate(90deg)" : undefined
                    }}
                    wrap={false}
                  >
                    <View
                      style={{
                        ...tw("flex flex-row justify-between"),
                        flexShrink: 0
                      }}
                    >
                      <View
                        style={{
                          ...tw("flex flex-col justify-start pr-2"),
                          flex: 1,
                          minWidth: 0
                        }}
                      >
                        {textBlocks.map(renderBlock)}
                      </View>
                      {rightBlocks.length > 0 && (
                        <View
                          style={{
                            ...tw("flex flex-col items-end justify-start"),
                            flexShrink: 0
                          }}
                        >
                          {rightBlocks.map(renderBlock)}
                        </View>
                      )}
                    </View>
                    {barcodeBlocks.map(renderBlock)}
                    {entityBlocks.map(renderBlock)}
                  </View>
                );
              })}
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
};

export default ProductLabelPDF;
