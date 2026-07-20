import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SalesOrderAssignment event. Not shipped (not exported from index.ts).
export default function SalesOrderAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Sales order assigned to you"}
      preview={"Sales order assigned to you"}
      message={"Sales Order SO-00045 assigned to you"}
      reference={"SO-00045"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/sales-order/1"}
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
          label: "Order date",
          value: "Jul 1, 2026"
        },
        {
          label: "Status",
          value: "Confirmed"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
