import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SupplierQuoteResponse event. Not shipped (not exported from index.ts).
export default function SupplierQuoteResponsePreview() {
  return (
    <NotificationEmail
      heading={"Supplier quote response"}
      preview={"Supplier quote response"}
      message={"Supplier Quote SQ-0014 was submitted by Globex Inc."}
      reference={"SQ-0014"}
      recipientName={"Naveen"}
      ctaLabel={"View response"}
      ctaUrl={"https://app.carbon.ms/x/supplier-quote/1"}
      details={[
        {
          label: "Submitted by",
          value: "Globex Inc."
        },
        {
          label: "Supplier",
          value: "Globex Inc."
        },
        {
          label: "Supplier ref",
          value: "SQ-GLX-2291"
        },
        {
          label: "Expires",
          value: "Aug 1, 2026"
        }
      ]}
    />
  );
}
