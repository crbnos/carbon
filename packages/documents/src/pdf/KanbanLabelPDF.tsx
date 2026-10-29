// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import {
  fitKanbanLabelText,
  getKanbanLabelLayout,
  KANBAN_LABEL_COLORS,
  type KanbanLabelAction,
  type KanbanLabelItem,
  kanbanLabelCode,
  kanbanLabelQuantityLines,
  kanbanLabelStorageText,
  wrapKanbanLabelText
} from "../zpl/KanbanLabelZPL";
import Footer from "./components/Footer";

/** A card, with its own action when one PDF mixes Create, Start and Complete. */
type KanbanLabelCard = KanbanLabelItem & { action?: KanbanLabelAction };

interface KanbanLabelPDFProps {
  baseUrl: string;
  labels: KanbanLabelCard[];
  /** The action of every card that names none. */
  action?: KanbanLabelAction;
  /** A thermal label: one card per page at its size. Omitted = a letter
   *  sheet of six. */
  labelSize?: LabelSize;
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

const KanbanLabelPDF = ({
  baseUrl,
  labels,
  action = "order",
  labelSize
}: KanbanLabelPDFProps) => {
  if (labelSize) {
    return (
      <ThermalKanbanLabels
        baseUrl={baseUrl}
        labels={labels}
        action={action}
        labelSize={labelSize}
      />
    );
  }

  // Fixed 2x3 layout (6 labels per page)
  const rows = 3;
  const columns = 2;

  // Standard letter size paper (8.5 x 11 inches in points)
  const LETTER_WIDTH = 8.5 * 72;
  const LETTER_HEIGHT = 11 * 72;

  // Reserve space for the footer (page number) at the bottom
  const footerHeight = 35;

  // Calculate label dimensions for 2x3 layout with margins
  const margin = 36; // 0.5 inch margins
  const labelWidth = (LETTER_WIDTH - 2 * margin) / columns;
  const labelHeight = (LETTER_HEIGHT - 2 * margin - footerHeight) / rows;

  // Calculate how many pages we need
  const labelsPerPage = rows * columns;
  const pageCount = Math.ceil(labels.length / labelsPerPage);

  // QR code size - make it prominent
  const qrCodeSize = Math.min(labelHeight * 0.35, labelWidth * 0.4);

  return (
    <Document>
      {Array.from({ length: pageCount }).map((_, pageIndex) => (
        <Page
          key={pageIndex}
          size={[LETTER_WIDTH, LETTER_HEIGHT]}
          style={tw("p-0")}
        >
          <View style={{ margin: margin }}>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <View
                key={`row-${rowIndex}`}
                style={{
                  flexDirection: "row"
                }}
                wrap={false}
              >
                {Array.from({ length: columns }).map((_, colIndex) => {
                  const itemIndex =
                    pageIndex * labelsPerPage + rowIndex * columns + colIndex;
                  const label = labels[itemIndex];

                  if (!label)
                    return (
                      <View
                        key={`empty-${colIndex}`}
                        style={{ width: labelWidth, height: labelHeight }}
                      />
                    );

                  const cardAction = label.action ?? action;
                  const code = kanbanLabelCode(label, baseUrl, cardAction);
                  const color = KANBAN_LABEL_COLORS[cardAction];

                  return (
                    <View
                      key={`label-${itemIndex}`}
                      style={{
                        ...tw(
                          "relative p-4 flex flex-col border border-gray-300"
                        ),
                        width: labelWidth,
                        height: labelHeight
                      }}
                    >
                      {/* QR Code and Thumbnail row */}
                      <View
                        style={tw(
                          "flex flex-row items-center justify-center mb-3"
                        )}
                      >
                        {/* QR Code, its caption under it: one sheet can
                            hold a kanban's Create, Start and Complete cards */}
                        <View style={tw("flex flex-col items-center")}>
                          <Image
                            src={generateQRCode(
                              code.url,
                              qrCodeSize / 72,
                              color
                            )}
                            style={{
                              width: qrCodeSize,
                              height: qrCodeSize,
                              objectFit: "contain"
                            }}
                          />
                          <Text
                            style={{
                              fontSize: "10pt",
                              fontFamily: "Helvetica-Bold",
                              color: `#${color}`
                            }}
                          >
                            {code.caption}
                          </Text>
                        </View>

                        {/* Thumbnail if available */}
                        {label.thumbnail ? (
                          <Image
                            src={label.thumbnail}
                            style={{
                              width: qrCodeSize,
                              height: qrCodeSize,
                              objectFit: "contain",
                              marginLeft: 8
                            }}
                          />
                        ) : null}
                      </View>

                      {/* Item Information */}
                      <View style={tw("flex-1 flex flex-col justify-center")}>
                        {/* Item Name - Main Title */}
                        <Text
                          style={{
                            ...tw("text-center mb-2"),
                            fontSize: "14pt",
                            fontWeight: "bold"
                          }}
                        >
                          {label.itemName}
                        </Text>

                        {/* Item ID */}
                        <Text
                          style={{
                            ...tw("text-center mb-1"),
                            fontSize: "10pt"
                          }}
                        >
                          {label.itemReadableId}
                        </Text>

                        {/* Location and Storage Unit */}
                        <View
                          style={tw(
                            "border-t border-gray-300 pt-2 mt-2 flex flex-col items-center text-center text-[14pt]"
                          )}
                        >
                          {label.fromStorageUnitName ? (
                            // Transfer kanban: show the source -> destination bins.
                            // Use ASCII "->": the built-in Helvetica font has no
                            // U+2192 glyph, so an arrow renders as a missing box.
                            <Text>
                              {label.fromStorageUnitName} {"->"}{" "}
                              {label.storageUnitName || label.locationName}
                            </Text>
                          ) : label.storageUnitName ? (
                            <Text>{label.storageUnitName}</Text>
                          ) : (
                            <Text>{label.locationName}</Text>
                          )}
                        </View>

                        {/* Quantity */}
                        <View
                          style={tw(
                            "border-t border-gray-300 pt-2 mt-2 flex items-center"
                          )}
                        >
                          <Text
                            style={{
                              ...tw("text-center"),
                              fontSize: "16pt",
                              fontWeight: "bold"
                            }}
                          >
                            QTY: {label.quantity}
                            {label.unitOfMeasureCode
                              ? ` ${label.unitOfMeasureCode}`
                              : ""}
                          </Text>
                          {label.replenishmentLevel != null && (
                            <Text
                              style={{
                                ...tw("text-center"),
                                fontSize: "16pt",
                                fontWeight: "bold"
                              }}
                            >
                              {/* The level is in stock units at the To
                                  storage unit; unitOfMeasureCode is the
                                  purchase unit, so MIN prints no unit. */}
                              MIN: {label.replenishmentLevel}
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* Kanban ID and supplier at bottom */}
                      <View
                        style={tw("flex flex-row items-center justify-between")}
                      >
                        {/* The built-in Helvetica has no bold weight, so
                            fontWeight alone renders regular. */}
                        <Text
                          style={{
                            fontSize: "12pt",
                            fontFamily: "Helvetica-Bold",
                            flexShrink: 0,
                            marginRight: 8
                          }}
                        >
                          {label.kanbanId ?? ""}
                        </Text>
                        <Text
                          style={{
                            fontSize: "12pt",
                            color: "#7d7d7d",
                            flex: 1,
                            textAlign: "right"
                          }}
                        >
                          {label.supplierName ?? ""}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          <Footer />
        </Page>
      ))}
    </Document>
  );
};

/**
 * One card per page, exactly the label's size, laid out by
 * `getKanbanLabelLayout` like the ZPL so a PDF to a thermal printer's driver
 * prints the same card. The code and its caption take the action's color
 * (green for Start, blue for Complete); a black-only printer still has the
 * caption.
 */
const ThermalKanbanLabels = ({
  baseUrl,
  labels,
  action,
  labelSize
}: Required<KanbanLabelPDFProps>) => {
  const pt = (inches: number) => inches * 72;

  return (
    <Document>
      {labels.map((label, cardIndex) => {
        const cardAction = label.action ?? action;
        const code = kanbanLabelCode(label, baseUrl, cardAction);
        const color = `#${KANBAN_LABEL_COLORS[cardAction]}`;
        const column = getKanbanLabelLayout(labelSize.width, labelSize.height);
        const name = wrapKanbanLabelText(
          label.itemName,
          column.textWidth,
          column.titleSize
        );
        const quantity = kanbanLabelQuantityLines(label);
        const layout = getKanbanLabelLayout(
          labelSize.width,
          labelSize.height,
          name.length,
          quantity.length
        );
        const { titleSize } = layout;

        const line = (
          key: string,
          y: number,
          size: number,
          value: string,
          style: { bold?: boolean; color?: string } = {}
        ) => (
          <Text
            key={key}
            style={{
              position: "absolute",
              left: pt(layout.margin),
              top: pt(y),
              fontSize: pt(size),
              fontFamily: style.bold ? "Helvetica-Bold" : "Helvetica",
              color: style.color
            }}
          >
            {fitKanbanLabelText(value, layout.textWidth, size)}
          </Text>
        );

        return (
          <Page
            key={`${label.id}-${cardAction}-${cardIndex}`}
            size={[pt(labelSize.width), pt(labelSize.height)]}
          >
            {name.map((nameLine, index) =>
              line(
                `name-${index}`,
                layout.nameY + index * (titleSize + layout.lineGap),
                titleSize,
                nameLine,
                { bold: true }
              )
            )}
            {line("item", layout.itemY, layout.textSize, label.itemReadableId)}
            {line(
              "storage",
              layout.storageY,
              layout.textSize,
              kanbanLabelStorageText(label)
            )}
            {quantity.map((quantityLine, index) =>
              line(
                `quantity-${index}`,
                layout.quantityY + index * (titleSize + layout.lineGap),
                titleSize,
                quantityLine,
                { bold: true }
              )
            )}
            {label.supplierName
              ? line(
                  "supplier",
                  layout.supplierY,
                  layout.textSize,
                  label.supplierName,
                  { color: "#7d7d7d" }
                )
              : null}
            {label.kanbanId
              ? line(
                  "kanbanId",
                  layout.kanbanIdY,
                  layout.textSize,
                  label.kanbanId,
                  { color: "#7d7d7d" }
                )
              : null}
            <Image
              src={generateQRCode(
                code.url,
                layout.codeSize,
                KANBAN_LABEL_COLORS[cardAction]
              )}
              style={{
                position: "absolute",
                left: pt(layout.codeX),
                top: pt(layout.codeY),
                width: pt(layout.codeSize),
                height: pt(layout.codeSize)
              }}
            />
            <Text
              style={{
                position: "absolute",
                left: pt(layout.codeX),
                top: pt(layout.captionY),
                width: pt(layout.codeSize),
                textAlign: "center",
                fontSize: pt(layout.captionSize),
                fontFamily: "Helvetica-Bold",
                color
              }}
            >
              {code.caption}
            </Text>
          </Page>
        );
      })}
    </Document>
  );
};

export default KanbanLabelPDF;
