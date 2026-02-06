import bwipjs from "@bwip-js/node";
import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import type { PDF } from "../types";
import { Header, Note, Template } from "./components";

interface PackingSlipProps extends PDF {
  customer:
    | Database["public"]["Tables"]["customer"]["Row"]
    | Database["public"]["Tables"]["supplier"]["Row"];
  customerReference?: string;
  sourceDocument?: string;
  sourceDocumentId?: string;
  shipment: Database["public"]["Tables"]["shipment"]["Row"];
  shipmentLines: Database["public"]["Views"]["shipmentLines"]["Row"][];
  shippingAddress: Database["public"]["Tables"]["address"]["Row"] | null;
  paymentTerm: { id: string; name: string };
  shippingMethod: { id: string; name: string };
  terms: JSONContent;
  trackedEntities: Database["public"]["Tables"]["trackedEntity"]["Row"][];
  thumbnails?: Record<string, string | null>;
}

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
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return dateStr;
  }
};

const PackingSlipPDF = ({
  company,
  customer,
  meta,
  customerReference,
  sourceDocument,
  sourceDocumentId,
  shipment,
  shipmentLines,
  shippingAddress,
  terms,
  paymentTerm,
  shippingMethod,
  title = "Packing Slip",
  trackedEntities,
  thumbnails
}: PackingSlipProps) => {
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode
  } = shippingAddress ?? {};

  const hasTrackedEntities = trackedEntities.length > 0;

  let rowIndex = 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "packing slip",
        subject: meta?.subject ?? "Packing Slip"
      }}
    >
      <Header
        company={company}
        title="Packing Slip"
        documentId={shipment?.shipmentId}
      />

      {/* Ship To */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Ship To
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {customer.name && (
                <Text style={tw("font-bold")}>{customer.name}</Text>
              )}
              {addressLine1 && (
                <Text style={tw("mt-1")}>{addressLine1}</Text>
              )}
              {addressLine2 && <Text>{addressLine2}</Text>}
              {(city || stateProvince || postalCode) && (
                <Text>
                  {formatCityStatePostalCode(city, stateProvince, postalCode)}
                </Text>
              )}
              {countryCode && <Text>{countryCode}</Text>}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Shipment Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {shipment?.postingDate && (
                <Text>Date: {formatDate(shipment.postingDate)}</Text>
              )}
              {sourceDocument && sourceDocumentId && (
                <Text>
                  {sourceDocument}: {sourceDocumentId}
                </Text>
              )}
              {customerReference && (
                <Text>Customer PO #: {customerReference}</Text>
              )}
              {shipment?.trackingNumber && (
                <Text>Tracking: {shipment.trackingNumber}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Shipping & Payment */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Shipping
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {shippingMethod?.name && (
                <Text>Method: {shippingMethod.name}</Text>
              )}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Payment
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {paymentTerm?.name && (
                <Text>Terms: {paymentTerm.name}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Line Items Table */}
      <View style={tw("mb-4")}>
        {/* Header */}
        <View
          style={tw(
            "flex flex-row bg-gray-800 py-2 px-3 text-white text-[9px] font-bold"
          )}
        >
          <Text
            style={tw(`w-${hasTrackedEntities ? "5/12" : "7/12"} text-left`)}
          >
            Description
          </Text>
          <Text style={tw("w-2/12 text-right")}>Qty</Text>
          {hasTrackedEntities && (
            <Text style={tw("w-5/12 text-right")}>Serial/Batch</Text>
          )}
        </View>

        {/* Rows */}
        {shipmentLines
          .filter((line) => line.shippedQuantity > 0)
          .map((line) => {
            const barcodeDataUrl = generateBarcode(line.itemReadableId);
            const trackedEntitiesForLine = trackedEntities.filter(
              (entity) =>
                (entity.attributes as TrackedEntityAttributes)?.[
                  "Shipment Line"
                ] === line.id
            );
            const isEven = rowIndex % 2 === 0;
            rowIndex++;

            return (
              <View
                key={line.id}
                style={tw(
                  `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${
                    isEven ? "bg-white" : "bg-gray-50"
                  }`
                )}
                wrap={false}
              >
                <View
                  style={tw(
                    `w-${hasTrackedEntities ? "5/12" : "7/12"} pr-2`
                  )}
                >
                  <Text style={tw("text-gray-800")}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                    {getLineDescriptionDetails(line)}
                  </Text>

                  {thumbnails &&
                    line.id in thumbnails &&
                    thumbnails[line.id] && (
                      <View style={tw("mt-1 w-16")}>
                        <Image
                          src={thumbnails[line.id]!}
                          style={tw("w-full h-auto")}
                        />
                      </View>
                    )}

                  <View style={tw("mt-1")}>
                    <Image
                      src={barcodeDataUrl}
                      style={tw("max-w-[50%]")}
                    />
                  </View>
                </View>
                <Text style={tw("w-2/12 text-right text-gray-600")}>
                  {getLineQuantity(line)}
                </Text>
                {hasTrackedEntities && (
                  <View style={tw("w-5/12 flex flex-col gap-1 items-end")}>
                    {trackedEntitiesForLine.map((entity) => {
                      const qrCodeDataUrl = generateQRCode(entity.id, 8);
                      return (
                        <View
                          key={entity.id}
                          style={tw("mb-1 flex flex-row items-center gap-1")}
                        >
                          <Text style={tw("text-[8px] text-gray-600")}>
                            {entity.id}
                          </Text>
                          <Image
                            src={qrCodeDataUrl}
                            style={{ width: 24, height: 24 }}
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
      </View>

      {/* Notes & Terms */}
      <View style={tw("flex flex-col gap-3 w-full")}>
        {Object.keys(shipment.externalNotes ?? {}).length > 0 && (
          <Note
            title="Notes"
            content={(shipment.externalNotes ?? {}) as JSONContent}
          />
        )}
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

function getLineQuantity(
  line: Database["public"]["Views"]["shipmentLines"]["Row"]
) {
  return `${line.shippedQuantity} / ${line.orderQuantity} ${line.unitOfMeasure}`;
}

function getLineDescription(
  line: Database["public"]["Views"]["shipmentLines"]["Row"]
) {
  return line.itemReadableId;
}

function getLineDescriptionDetails(
  line: Database["public"]["Views"]["shipmentLines"]["Row"]
) {
  return line.description;
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
export default PackingSlipPDF;
