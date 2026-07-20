import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SalesRfqReady event. Not shipped (not exported from index.ts).
export default function SalesRfqReadyPreview() {
  return (
    <NotificationEmail
      heading={"RFQ ready for quote"}
      preview={"RFQ ready for quote"}
      message={"RFQ RFQ-0007 is ready for quote"}
      reference={"RFQ-0007"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/sales-rfq/1"}
      details={[
        {
          label: "Customer",
          value: "Acme Corporation"
        },
        {
          label: "Customer ref",
          value: "PO-88921"
        },
        {
          label: "Expires",
          value: "Aug 14, 2026"
        }
      ]}
    />
  );
}
