import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ApprovalRejected event. Not shipped (not exported from index.ts).
export default function ApprovalRejectedPreview() {
  return (
    <NotificationEmail
      heading={"Your request was rejected"}
      preview={"Your request was rejected"}
      message={"Purchase order PO-00099 was rejected"}
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
          value: "Rejected"
        },
        {
          label: "Rejected by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
