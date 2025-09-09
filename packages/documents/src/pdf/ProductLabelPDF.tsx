import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";

interface ProductLabelProps {
  items: ProductLabelItem[];
  labelSize: LabelSize;
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

const ProductLabelPDF = ({ items, labelSize }: ProductLabelProps) => {
  // Default to 1 row and 1 column if not specified
  const rows = labelSize.rows || 1;
  const columns = labelSize.columns || 1;
  const rotated = labelSize.rotated || false;

  // Standard letter size paper (8.5 x 11 inches in points)
  const LETTER_WIDTH = 8.5 * 72;
  const LETTER_HEIGHT = 11 * 72;

  // Calculate dimensions in points (72 points per inch)
  const labelWidthPt = labelSize.width * 72;
  const labelHeightPt = labelSize.height * 72;

  // Account for rotation when calculating effective dimensions
  const effectiveLabelWidthPt = rotated ? labelHeightPt : labelWidthPt;
  const effectiveLabelHeightPt = rotated ? labelWidthPt : labelHeightPt;

  // Determine page size based on rows and columns
  let pageWidth, pageHeight;

  if (rows > 1 || columns > 1) {
    // Using standard letter size paper
    pageWidth = LETTER_WIDTH;
    pageHeight = LETTER_HEIGHT;
  } else {
    // Single label per page - use effective dimensions for rotated labels
    pageWidth = effectiveLabelWidthPt;
    pageHeight = effectiveLabelHeightPt;
  }

  // Calculate font sizes based on label height
  // Base sizes are optimized for labelSize.height = 1
  // Scale up proportionally as height increases, with a cap at height = 4
  const scaleFactor = Math.min(labelSize.height, 4);
  const titleFontSize = 10 * Math.sqrt(scaleFactor);
  const descriptionFontSize = 7 * Math.sqrt(scaleFactor);

  // QR code size based on effective label dimensions accounting for rotation
  const qrCodeSize = Math.min(
    effectiveLabelHeightPt * 0.8,
    effectiveLabelWidthPt * 0.4
  );

  // Calculate how many pages we need
  const labelsPerPage = rows * columns;
  const pageCount = Math.ceil(items.length / labelsPerPage);

  // Calculate margins to center labels on the page
  // Use effective dimensions for rotated labels
  const horizontalMargin = (pageWidth - columns * effectiveLabelWidthPt) / 2;
  const verticalMargin = (pageHeight - rows * effectiveLabelHeightPt) / 2;

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
                marginTop: rowIndex === 0 ? verticalMargin : 0,
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

                return (
                  <View
                    key={`label-${itemIndex}`}
                    style={{
                      ...tw("relative p-2 flex flex-col pl-[10pt]"),
                      width: labelWidthPt,
                      height: labelHeightPt,
                      transform: rotated ? "rotate(90deg)" : undefined,
                    }}
                  >
                    <View style={tw("flex flex-row justify-between")}>
                      <View
                        style={tw("flex flex-col justify-center flex-1 pr-2")}
                      >
                        <Text
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                            ...tw("mb-2"),
                            fontWeight: "bold",
                            fontSize: `${titleFontSize}pt`,
                          }}
                        >
                          {item.itemId}
                        </Text>

                        {item.revision && (
                          <Text
                            style={{
                              ...tw("mb-1"),
                              fontSize: `${descriptionFontSize}pt`,
                            }}
                          >
                            Rev: {item.revision}
                          </Text>
                        )}

                        {["Serial", "Batch"].includes(item.trackingType) && (
                          <Text
                            style={{
                              ...tw("mb-1"),
                              fontSize: `${descriptionFontSize}pt`,
                            }}
                          >
                            Qty: {item.quantity}
                          </Text>
                        )}

                        {item.trackingType === "Serial" && item.number && (
                          <Text
                            style={{
                              ...tw("mb-1"),
                              fontSize: `${descriptionFontSize}pt`,
                            }}
                          >
                            S/N: {item.number}
                          </Text>
                        )}
                        {item.trackingType === "Batch" && item.number && (
                          <Text
                            style={{
                              ...tw("mb-1"),
                              fontSize: `${descriptionFontSize}pt`,
                            }}
                          >
                            Batch: {item.number}
                          </Text>
                        )}
                      </View>

                      <View style={tw("flex items-center justify-center")}>
                        <Image
                          src={generateQRCode(
                            item.trackedEntityId,
                            qrCodeSize / 72
                          )}
                          style={{
                            width: qrCodeSize,
                            height: qrCodeSize,
                            objectFit: "contain",
                          }}
                        />
                      </View>
                    </View>

                    {item.trackedEntityId && (
                      <Text
                        style={{
                          ...tw("mt-1 text-center"),
                          fontSize: `${descriptionFontSize - 1}pt`,
                          width: "100%",
                        }}
                      >
                        {item.trackedEntityId}
                      </Text>
                    )}
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
