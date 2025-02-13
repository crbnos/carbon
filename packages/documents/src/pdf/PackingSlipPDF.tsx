import type { Database } from "@carbon/database";
import { Text, View, Image } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import bwipjs from "@bwip-js/node";
import { formatCityStatePostalCode } from "@carbon/utils";
import type { JSONContent } from "@carbon/react";
import type { PDF } from "../types";
import { Header, Note, Summary, Template } from "./components";

interface PackingSlipProps extends PDF {
  customer: Database["public"]["Tables"]["customer"]["Row"];
  shipment: Database["public"]["Tables"]["shipment"]["Row"];
  shipmentLines: Database["public"]["Views"]["shipmentLines"]["Row"][];
  shippingAddress: Database["public"]["Tables"]["address"]["Row"] | null;
  paymentTerm: { id: string; name: string };
  shippingMethod: { id: string; name: string };
  terms: JSONContent;
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
  shipment,
  shipmentLines,
  shippingAddress,
  terms,
  paymentTerm,
  shippingMethod,
  title = "Packing Slip",
}: PackingSlipProps) => {
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode,
  } = shippingAddress ?? {};

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
        keywords: meta?.keywords ?? "packing slip",
        subject: meta?.subject ?? "Packing Slip",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Date",
              value: shipment?.postingDate,
            },
            {
              label: "Shipment #",
              value: shipment?.shipmentId,
            },
          ]}
        />
        {shipment?.trackingNumber && (
          <View style={tw("flex flex-col gap-2 justify-between mb-5")}>
            <Text style={tw("text-gray-500 text-xs")}>Tracking Number</Text>
            <Text style={tw("text-sm")}>{shipment?.trackingNumber}</Text>
          </View>
        )}

        <View style={tw("flex flex-row justify-between mb-5")}>
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
        <View style={tw("mb-5 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center mt-5 py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
            )}
          >
            <Text style={tw("w-5/12 text-left")}>Description</Text>
            <Text style={tw("w-1/6 text-center")}>Qty</Text>
            <Text style={tw("w-1/6 text-right")}>Barcode</Text>
          </View>
          {shipmentLines.map((line) => {
            const barcodeDataUrl = generateBarcode(line.itemReadableId);
            return (
              <View
                style={tw(
                  "flex flex-row justify-between py-3 px-[6px] border-b border-gray-300"
                )}
                key={line.id}
              >
                <View style={tw("w-1/2")}>
                  <Text style={tw("font-bold mb-1")}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={tw("text-[9px] opacity-80")}>
                    {getLineDescriptionDetails(line)}
                  </Text>
                </View>
                <Text style={tw("w-1/4 text-center")}>
                  {line.shippedQuantity} {line.unitOfMeasure}
                </Text>
                <Image style={tw("w-1/4 text-right")} src={barcodeDataUrl} />
              </View>
            );
          })}
        </View>
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

function getLineDescription(
  line: Database["public"]["Tables"]["shipmentLine"]["Row"]
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
    height: 10, // Bar height, in millimeters
    includetext: true, // Show human-readable text
    textxalign: "center", // Always good to set this
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export default PackingSlipPDF;
