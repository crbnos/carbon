import bwipjs from "@bwip-js/node";
import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import type { PDF } from "../types";
import { Header, Note, Summary, Template } from "./components";

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
  thumbnails,
}: PackingSlipProps) => {
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode,
  } = shippingAddress ?? {};

  const details = [
    {
      label: "Date",
      value: shipment?.postingDate,
    },
    {
      label: "Shipment",
      value: shipment?.shipmentId,
    },
  ];

  if (sourceDocument) {
    details.push({
      label: sourceDocument,
      value: sourceDocumentId,
    });
  }

  if (customerReference) {
    details.push({
      label: "Reference",
      value: customerReference,
    });
  }

  const hasTrackedEntities = trackedEntities.length > 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "packing slip",
        subject: meta?.subject ?? "Packing Slip",
      }}
    >
      <View style={tw("flex flex-col")}>
        {/* Header Section - Always at the top */}
        <View style={tw("mb-4")}>
          <Header title={title} company={company} />
          <Summary company={company} items={details} />
          {shipment?.trackingNumber && (
            <View style={tw("flex flex-col gap-2 justify-between mb-5")}>
              <Text style={tw("text-gray-500 text-xs")}>Tracking Number</Text>
              <Text style={tw("text-sm")}>{shipment?.trackingNumber}</Text>
            </View>
          )}
        </View>

        {/* Shipping Information Section */}
        <View
          style={tw(
            "flex flex-row justify-between mb-6 page-break-inside-avoid"
          )}
        >
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
            <Text style={tw("text-sm")}>{customer.name}</Text>
            {shippingAddress && (
              <>
                {addressLine1 && (
                  <Text style={tw("text-sm")}>{addressLine1}</Text>
                )}
                {addressLine2 && (
                  <Text style={tw("text-sm")}>{addressLine2}</Text>
                )}
                <Text style={tw("text-sm")}>
                  {formatCityStatePostalCode(city, stateProvince, postalCode)}
                </Text>
                <Text style={tw("text-sm")}>{countryCode}</Text>
              </>
            )}
          </View>

          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Method</Text>
            <Text style={tw("text-sm")}>{shippingMethod.name}</Text>
          </View>

          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Payment Term</Text>
            <Text style={tw("text-sm")}>{paymentTerm.name}</Text>
          </View>
        </View>

        {/* Line Items Section */}
        <View style={tw("mb-6 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center mt-5 py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid"
            )}
          >
            <Text
              style={tw(`w-${hasTrackedEntities ? "7/12" : "9/12"} text-left`)}
            >
              Description
            </Text>
            <Text
              style={tw(`w-${hasTrackedEntities ? "1/6" : "3/12"} text-center`)}
            >
              Qty
            </Text>
            {hasTrackedEntities && (
              <Text style={tw("w-1/4 text-right")}>Serial/Batch</Text>
            )}
          </View>

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
              return (
                <View
                  style={tw(
                    "flex flex-row justify-between py-3 px-[6px] border-b border-gray-300 page-break-inside-avoid"
                  )}
                  key={line.id}
                >
                  <View style={tw(`w-${hasTrackedEntities ? "7/12" : "9/12"}`)}>
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
                  <Text
                    style={tw(
                      `w-${hasTrackedEntities ? "1/6" : "3/12"} text-center`
                    )}
                  >
                    {getLineQuantity(line)}
                  </Text>
                  {hasTrackedEntities && (
                    <View style={tw("flex flex-col gap-2 w-1/4 text-right")}>
                      {trackedEntitiesForLine.length > 0 && (
                        <View>
                          {trackedEntitiesForLine.map((entity) => {
                            const qrCodeDataUrl = generateQRCode(entity.id, 8);
                            return (
                              <View
                                key={entity.id}
                                style={tw("mb-2 text-right")}
                              >
                                <Text style={tw("text-[8px] mb-1")}>
                                  {entity.id}
                                </Text>
                                <Image
                                  src={qrCodeDataUrl}
                                  style={tw("max-w-[80%] ml-auto")}
                                />
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
        </View>

        {/* Notes and Terms Section */}
        <View style={tw("flex flex-col gap-4 w-full")}>
          <Note
            title="Notes"
            content={(shipment.externalNotes ?? {}) as JSONContent}
          />
          <Note title="Standard Terms & Conditions" content={terms} />
        </View>
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
    textxalign: "center", // Always good to set this
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
export default PackingSlipPDF;
