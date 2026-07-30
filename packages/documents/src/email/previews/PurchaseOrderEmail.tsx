import type { Database } from "@carbon/database";
import PurchaseOrderEmail from "../PurchaseOrderEmail";

const company = {
  name: "Tombstone Machine Works",
  logoLightIcon: null,
  baseCurrencyCode: "USD"
} as unknown as Database["public"]["Views"]["companies"]["Row"];

const purchaseOrder = {
  purchaseOrderId: "PO-00099",
  paymentTermId: "payment-term-net-30",
  receiptRequestedDate: "2026-08-14",
  externalNotes: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Please include material certs with the shipment and reference PO-00099 on all packing slips."
          }
        ]
      }
    ]
  }
} as unknown as Database["public"]["Views"]["purchaseOrders"]["Row"];

const purchaseOrderLines = [
  {
    id: "po-line-1",
    purchaseOrderLineType: "Part",
    supplierPartId: "GLX-6061-BRKT",
    supplierPartIdFromSupplier: null,
    itemReadableId: "BRKT-6061",
    description: "6061-T6 Aluminum Bracket",
    itemDescription: "CNC machined, clear anodize per MIL-A-8625 Type II",
    purchaseQuantity: 25,
    purchaseUnitOfMeasureCode: "EA",
    unitPrice: 42.5,
    supplierUnitPrice: 42.5,
    supplierShippingCost: 0,
    supplierTaxAmount: 0
  },
  {
    id: "po-line-2",
    purchaseOrderLineType: "Part",
    supplierPartId: "",
    supplierPartIdFromSupplier: null,
    itemReadableId: "FAS-M8-125",
    description: "M8x1.25 Hex Bolt",
    itemDescription: "Class 10.9, zinc plated, 30mm length",
    purchaseQuantity: 500,
    purchaseUnitOfMeasureCode: "EA",
    unitPrice: 0.18,
    supplierUnitPrice: 0.18,
    supplierShippingCost: 12.5,
    supplierTaxAmount: 0
  },
  {
    id: "po-line-3",
    purchaseOrderLineType: "Comment",
    supplierPartId: null,
    supplierPartIdFromSupplier: null,
    itemReadableId: null,
    description:
      "Partial shipments accepted. Contact purchasing before substituting alloys.",
    itemDescription: null,
    purchaseQuantity: null,
    purchaseUnitOfMeasureCode: null,
    unitPrice: null,
    supplierUnitPrice: null,
    supplierShippingCost: null,
    supplierTaxAmount: null
  }
] as unknown as Database["public"]["Views"]["purchaseOrderLines"]["Row"][];

const purchaseOrderLocations = {
  deliveryName: "Tombstone Machine Works — Plant 1",
  deliveryAddressLine1: "4501 Foundry Road",
  deliveryAddressLine2: "Dock B",
  deliveryCity: "Tombstone",
  deliveryStateProvince: "AZ",
  deliveryPostalCode: "85638",
  deliveryCountryName: "United States",
  dropShipment: false,
  customerName: null,
  customerAddressLine1: null,
  customerAddressLine2: null,
  customerCity: null,
  customerStateProvince: null,
  customerPostalCode: null,
  customerCountryName: null
} as unknown as Database["public"]["Views"]["purchaseOrderLocations"]["Row"];

export default function PurchaseOrderEmailPreview() {
  return (
    <PurchaseOrderEmail
      company={company}
      locale="en-US"
      purchaseOrder={purchaseOrder}
      purchaseOrderLines={purchaseOrderLines}
      purchaseOrderLocations={purchaseOrderLocations}
      paymentTerms={[{ id: "payment-term-net-30", name: "Net 30" }]}
      recipient={{
        firstName: "Tom",
        lastName: "Sawyer",
        email: "tom.sawyer@globex.com"
      }}
      sender={{
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@tombstone.ms"
      }}
    />
  );
}
