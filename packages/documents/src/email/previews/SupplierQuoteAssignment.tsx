import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SupplierQuoteAssignment event. Not shipped (not exported from index.ts).
export default function SupplierQuoteAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Supplier quote assigned to you"}
      preview={"Supplier quote assigned to you"}
      message={"Supplier Quote SQ-0014 assigned to you"}
      reference={"SQ-0014"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/supplier-quote/1"}
      details={[
        {
          label: "Supplier",
          value: "Globex Inc."
        },
        {
          label: "Expires",
          value: "Aug 1, 2026"
        },
        {
          label: "Status",
          value: "Active"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
