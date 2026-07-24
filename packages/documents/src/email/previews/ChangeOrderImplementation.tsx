import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ChangeOrderImplementation event. Not shipped (not exported from index.ts).
export default function ChangeOrderImplementationPreview() {
  return (
    <NotificationEmail
      heading={"Change order in implementation"}
      preview={"Change order in implementation"}
      message={"Change order ECO-00042 has moved to implementation"}
      reference={"ECO-00042"}
      recipientName={"Jane Doe"}
      ctaLabel={"View change order"}
      ctaUrl={"https://app.carbon.ms/x/items/change-order/1/details"}
      details={[
        {
          label: "Status",
          value: "Implementation"
        }
      ]}
    />
  );
}
