import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// QuoteAssignment event. Not shipped (not exported from index.ts).
export default function QuoteAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Quote assigned to you"}
      preview={"Quote assigned to you"}
      message={"Quote Q-00012 assigned to you"}
      reference={"Q-00012"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
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
          label: "Expires",
          value: "Aug 14, 2026"
        },
        {
          label: "Status",
          value: "Sent"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
