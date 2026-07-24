import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ChangeOrderDone event. Not shipped (not exported from index.ts).
export default function ChangeOrderDonePreview() {
  return (
    <NotificationEmail
      heading={"Change order complete"}
      preview={"Change order complete"}
      message={"Change order ECO-000012 is complete"}
      reference={"ECO-000012"}
      recipientName={"John Doe"}
      ctaLabel={"View change order"}
      ctaUrl={"https://app.carbon.ms/x/items/change-order/1/details"}
      details={[
        {
          label: "Name",
          value: "Bracket tolerance fix"
        },
        {
          label: "Type",
          value: "Engineering"
        },
        {
          label: "Priority",
          value: "High"
        },
        {
          label: "Due",
          value: "Aug 14, 2026"
        },
        {
          label: "Status",
          value: "Done"
        },
        {
          label: "Assignee",
          value: "Jane Doe"
        }
      ]}
    />
  );
}
