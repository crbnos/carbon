import bwipjs from "@bwip-js/node";
import { getAppUrl } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import type { PDF } from "../types";
import { Header, Summary, Template } from "./components";

interface StockTransferPDFProps extends PDF {
  stockTransfer: Database["public"]["Tables"]["stockTransfer"]["Row"];
  stockTransferLines: Database["public"]["Views"]["stockTransferLines"]["Row"][];
  location: Database["public"]["Tables"]["location"]["Row"];
  thumbnails?: Record<string, string | null>;
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          500: "#7d7d7d",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const StockTransferPDF = ({
  company,
  stockTransfer,
  stockTransferLines,
  location,
  title = "Stock Transfer",
  thumbnails
}: StockTransferPDFProps) => {
  const details = [
    {
      label: "Date",
      value: stockTransfer?.createdAt
        ? new Date(stockTransfer.createdAt).toLocaleDateString()
        : ""
    },
    {
      label: "Stock Transfer",
      value: stockTransfer?.stockTransferId
    },
    {
      label: "Location",
      value: location?.name
    }
  ];

  if (stockTransfer?.assignee) {
    details.push({
      label: "Assignee",
      value: stockTransfer.assignee
    });
  }

  return (
    <Template
      title={title}
      meta={{
        author: "Carbon",
        keywords: "stock transfer",
        subject: "Stock Transfer"
      }}
    >
      <View style={tw("flex flex-col")}>
        {/* Header Section - Always at the top */}
        <View style={tw("mb-4")}>
          <Header company={company} title={title} />
          <Summary company={company} items={details} />
        </View>

        {/* Line Items Section */}
        <View style={tw("mb-6 text-xs")}>
          <View
            style={tw(
              "flex flex-row bg-gray-800 py-2 px-3 text-white text-[9px] font-bold"
            )}
          >
            <Text style={tw("w-2/5 text-left")}>Description</Text>
            <Text style={tw("w-1/4 text-center")}>Transfer</Text>
            <Text style={tw("w-1/6 text-center")}>Qty</Text>
            <Text style={tw("w-1/8 text-center")}>Pick</Text>
          </View>

          {stockTransferLines
            .sort((a, b) => {
              const shelfA = a.fromShelfName || "Any";
              const shelfB = b.fromShelfName || "Any";
              return shelfA.localeCompare(shelfB);
            })
            .map((line) => {
              const barcodeDataUrl = generateBarcode(line.itemReadableId);
              let pickUrl = `${getAppUrl()}/api/stock-transfer/${line.id}/pick`;
              if (line.requiresSerialTracking) {
                pickUrl += "?type=serial";
              } else if (line.requiresBatchTracking) {
                pickUrl += "?type=batch";
              }
              const pickQRCode = generateQRCode(pickUrl, 4);

              return (
                <View
                  style={tw(
                    "flex flex-row justify-between py-2 px-3 border-b border-gray-200 text-[10px]"
                  )}
                  key={line.id}
                  wrap={false}
                >
                  <View style={tw("w-2/5")}>
                    <Text style={tw("font-bold mb-1")}>
                      {getLineDescription(line)}
                    </Text>
                    <Text style={tw("text-[9px] opacity-80 mb-2")}>
                      {getLineDescriptionDetails(line)}
                    </Text>

                    {thumbnails &&
                      line.id in thumbnails &&
                      thumbnails[line.id] && (
                        <View style={tw("mt-2 mb-2")}>
                          <Image
                            src={thumbnails[line.id]!}
                            style={tw("w-1/4 h-auto max-w-[25%]")}
                          />
                        </View>
                      )}

                    <Image src={barcodeDataUrl} style={tw("max-w-[50%]")} />
                  </View>

                  <View style={tw("w-1/4 text-center")}>
                    <Text style={tw("text-xs")}>
                      {line.fromShelfName || "Any"} →{" "}
                      {line.toShelfName || "Any"}
                    </Text>
                  </View>

                  <Text style={tw("w-1/6 text-center")}>
                    {getLineQuantity(line)}
                  </Text>

                  <View style={tw("w-1/8 flex flex-col items-center")}>
                    <Image src={pickQRCode} style={tw("h-16 w-16")} />
                  </View>
                </View>
              );
            })}
        </View>
      </View>
    </Template>
  );
};

function getLineQuantity(
  line: Database["public"]["Views"]["stockTransferLines"]["Row"]
) {
  return `${line.quantity} ${line.unitOfMeasure}`;
}

function getLineDescription(
  line: Database["public"]["Views"]["stockTransferLines"]["Row"]
) {
  return line.itemDescription;
}

function getLineDescriptionDetails(
  line: Database["public"]["Views"]["stockTransferLines"]["Row"]
) {
  return line.itemReadableId;
}

async function generateBarcode(text: string): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: "code128", // Barcode type
    text: text, // Text to encode
    scale: 3, // 3x scaling factor
    height: 5, // Bar height, in millimeters
    includetext: true, // Show human-readable text
    textxalign: "center" // Always good to set this
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export default StockTransferPDF;
