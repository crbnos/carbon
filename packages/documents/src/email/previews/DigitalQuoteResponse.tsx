import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// DigitalQuoteResponse event. Not shipped (not exported from index.ts).
export default function DigitalQuoteResponsePreview() {
  return (
    <NotificationEmail
      heading={"Digital quote response"}
      preview={"Digital quote response"}
      message={"Digital Quote Q-00012 was completed by buyer@acme.com"}
      reference={"Q-00012"}
      recipientName={"Naveen"}
      ctaLabel={"View response"}
      ctaUrl={"https://app.carbon.ms/x/quote/1"}
      details={[
        {
          label: "Response",
          value: "Completed by buyer@acme.com"
        },
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
        },
        {
          label: "Status",
          value: "Ordered"
        }
      ]}
    />
  );
}
