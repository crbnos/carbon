import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";

interface KanbanLabel {
  id: string;
  itemId: string;
  itemName: string;
  itemReadableId: string;
  locationName: string;
  supplierName?: string | null;
  shelfId?: string | null;
  shelfName?: string | null;
  quantity: number;
  unitOfMeasureCode?: string | null;
  thumbnail?: string | null;
}

interface KanbanLabelPDFProps {
  labels: KanbanLabel[];
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"],
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d",
        },
      },
    },
  },
});

const KanbanLabelPDF = ({ labels }: KanbanLabelPDFProps) => {
  // Fixed 2x3 layout (6 labels per page)
  const rows = 3;
  const columns = 2;

  // Standard letter size paper (8.5 x 11 inches in points)
  const LETTER_WIDTH = 8.5 * 72;
  const LETTER_HEIGHT = 11 * 72;

  // Calculate label dimensions for 2x3 layout with margins
  const margin = 36; // 0.5 inch margins
  const labelWidth = (LETTER_WIDTH - 2 * margin) / columns;
  const labelHeight = (LETTER_HEIGHT - 2 * margin) / rows;

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
                  flexDirection: "row",
                }}
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

                  return (
                    <View
                      key={`label-${itemIndex}`}
                      style={{
                        ...tw(
                          "relative p-4 flex flex-col border border-gray-300"
                        ),
                        width: labelWidth,
                        height: labelHeight,
                      }}
                    >
                      {/* QR Code at the top */}
                      <View style={tw("flex items-center justify-center mb-3")}>
                        <Image
                          src={generateQRCode(label.id, qrCodeSize / 72)}
                          style={{
                            width: qrCodeSize,
                            height: qrCodeSize,
                            objectFit: "contain",
                          }}
                        />
                      </View>

                      {/* Item Information */}
                      <View style={tw("flex-1 flex flex-col justify-center")}>
                        {/* Item Name - Main Title */}
                        <Text
                          style={{
                            ...tw("text-center mb-2"),
                            fontSize: "14pt",
                            fontWeight: "bold",
                          }}
                        >
                          {label.itemName}
                        </Text>

                        {/* Item ID */}
                        <Text
                          style={{
                            ...tw("text-center mb-1"),
                            fontSize: "10pt",
                          }}
                        >
                          {label.itemReadableId}
                        </Text>

                        {/* Thumbnail if available */}
                        {label.thumbnail && (
                          <View style={tw("flex items-center mb-2")}>
                            <Image
                              src={label.thumbnail}
                              style={{
                                width: labelWidth * 0.3,
                                height: labelHeight * 0.15,
                                objectFit: "contain",
                              }}
                            />
                          </View>
                        )}

                        {/* Location and Shelf */}
                        <View
                          style={tw(
                            "border-t border-gray-300 pt-2 mt-2 flex flex-col items-center text-center text-[14pt]"
                          )}
                        >
                          {label.shelfName ? (
                            <Text>{label.shelfName}</Text>
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
                              fontWeight: "bold",
                            }}
                          >
                            QTY: {label.quantity}
                            {label.unitOfMeasureCode
                              ? ` ${label.unitOfMeasureCode}`
                              : ""}
                          </Text>
                        </View>
                      </View>

                      {/* Kanban ID at bottom */}
                      <Text
                        style={{
                          ...tw("text-center"),
                          fontSize: "12pt",
                          color: "#7d7d7d",
                        }}
                      >
                        {label.supplierName}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </Page>
      ))}
    </Document>
  );
};

export default KanbanLabelPDF;
