import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// PurchaseInvoiceAssignment event. Not shipped (not exported from index.ts).
export default function PurchaseInvoiceAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Purchase invoice assigned to you"}
      preview={"Purchase invoice assigned to you"}
      message={"Purchase Invoice PINV-0031 assigned to you"}
      reference={"PINV-0031"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/purchase-invoice/1"}
      details={[
        {
          label: "Supplier",
          value: "Globex Inc."
        },
        {
          label: "Amount",
          value: "$12,500.00"
        },
        {
          label: "Status",
          value: "Draft"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
