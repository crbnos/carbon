import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SalesRfqAssignment event. Not shipped (not exported from index.ts).
export default function SalesRfqAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"RFQ assigned to you"}
      preview={"RFQ assigned to you"}
      message={"RFQ RFQ-0007 assigned to you"}
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
        },
        {
          label: "Status",
          value: "Ready for Quote"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
