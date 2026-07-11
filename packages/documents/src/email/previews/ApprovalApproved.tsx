import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ApprovalApproved event. Not shipped (not exported from index.ts).
export default function ApprovalApprovedPreview() {
  return (
    <NotificationEmail
      heading={"Your request was approved"}
      preview={"Your request was approved"}
      message={"Purchase order PO-00099 was approved"}
      reference={"PO-00099"}
      recipientName={"Naveen"}
      ctaLabel={"View decision"}
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
          value: "To Receive"
        },
        {
          label: "Approved by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
