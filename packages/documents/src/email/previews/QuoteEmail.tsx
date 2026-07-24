import type { Database } from "@carbon/database";
import type { CompanySettings } from "../../types";
import QuoteEmail from "../QuoteEmail";

const company = {
  name: "Tombstone Machine Works",
  logoLightIcon: null,
  baseCurrencyCode: "USD"
} as unknown as Database["public"]["Views"]["companies"]["Row"];

const quote = {
  quoteId: "QUO-00042",
  customerReference: "RFQ-77812",
  expirationDate: "2026-08-23",
  externalLinkId: "a1b2c3d4e5f6",
  externalNotes: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Pricing includes first article inspection. Lead time is 3 weeks after order confirmation."
          }
        ]
      }
    ]
  }
} as unknown as Database["public"]["Tables"]["quote"]["Row"];

const companySettings = {
  digitalQuoteEnabled: true
} as unknown as CompanySettings;

export default function QuoteEmailPreview() {
  return (
    <QuoteEmail
      company={company}
      companySettings={companySettings}
      locale="en-US"
      quote={quote}
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
