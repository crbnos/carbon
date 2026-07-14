import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// QuoteExpired event. Not shipped (not exported from index.ts).
export default function QuoteExpiredPreview() {
  return (
    <NotificationEmail
      heading={"Quote expired"}
      preview={"Quote expired"}
      message={"Quote Q-00012 has expired"}
      reference={"Q-00012"}
      recipientName={"Naveen"}
      ctaLabel={"View quote"}
      ctaUrl={"https://app.carbon.ms/x/quote/1"}
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
          label: "Expired",
          value: "Jun 30, 2026"
        }
      ]}
    />
  );
}
