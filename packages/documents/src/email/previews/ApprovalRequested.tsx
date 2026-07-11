import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ApprovalRequested event. Not shipped (not exported from index.ts).
export default function ApprovalRequestedPreview() {
  return (
    <NotificationEmail
      heading={"Approval requested"}
      preview={"Approval requested"}
      message={"Purchase order PO-00099 requires your approval"}
      reference={"PO-00099"}
      recipientName={"Naveen"}
      ctaLabel={"Review approval"}
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
          label: "Status",
          value: "Needs Approval"
        },
        {
          label: "Requested by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
