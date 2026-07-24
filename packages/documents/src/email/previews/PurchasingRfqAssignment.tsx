import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// PurchasingRfqAssignment event. Not shipped (not exported from index.ts).
export default function PurchasingRfqAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Purchasing RFQ assigned to you"}
      preview={"Purchasing RFQ assigned to you"}
      message={"Purchasing RFQ PRFQ-0004 assigned to you"}
      reference={"PRFQ-0004"}
      recipientName={"John Doe"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/purchasing-rfq/1"}
      details={[
        {
          label: "RFQ date",
          value: "Jul 6, 2026"
        },
        {
          label: "Expires",
          value: "Aug 14, 2026"
        },
        {
          label: "Status",
          value: "Requested"
        }
      ]}
    />
  );
}
