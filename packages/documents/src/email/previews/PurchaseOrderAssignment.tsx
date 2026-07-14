import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// PurchaseOrderAssignment event. Not shipped (not exported from index.ts).
export default function PurchaseOrderAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Purchase order assigned to you"}
      preview={"Purchase order assigned to you"}
      message={"Purchase Order PO-00099 assigned to you"}
      reference={"PO-00099"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/purchase-order/1"}
      details={[
        {
          label: "Supplier",
          value: "Globex Inc."
        },
        {
          label: "Supplier ref",
          value: "SREF-55"
        },
        {
          label: "Order date",
          value: "Jul 1, 2026"
        },
        {
          label: "Status",
          value: "To Receive"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
