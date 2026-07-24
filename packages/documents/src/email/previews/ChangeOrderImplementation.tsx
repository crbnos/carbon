import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ChangeOrderImplementation event. Not shipped (not exported from index.ts).
export default function ChangeOrderImplementationPreview() {
  return (
    <NotificationEmail
      heading={"Change order in implementation"}
      preview={"Change order in implementation"}
      message={"Change order ECO-000012 has moved to implementation"}
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
          value: "Implementation"
        },
        {
          label: "Assignee",
          value: "Jane Doe"
        }
      ]}
    />
  );
}
