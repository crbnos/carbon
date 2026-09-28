import type { Database } from "@carbon/database";
import CertificateOfConformanceEmail from "../CertificateOfConformanceEmail";

const company = {
  name: "Tombstone Machine Works",
  logoLightIcon: null,
  baseCurrencyCode: "USD"
} as unknown as Database["public"]["Views"]["companies"]["Row"];

export default function CertificateOfConformanceEmailPreview() {
  return (
    <CertificateOfConformanceEmail
      company={company}
      locale="en-US"
      certificateNumber="COC000012-0"
      shipmentId="SHP000087"
      customerPurchaseOrder="PO-88421"
      lines={[
        {
          itemNumber: "1 — GX-4471",
          description: "Actuator bracket, 7075-T6",
          quantity: "10 EA"
        },
        {
          itemNumber: "2 — HSG-220",
          description: "Sensor housing, anodized",
          quantity: "3 EA"
        }
      ]}
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
