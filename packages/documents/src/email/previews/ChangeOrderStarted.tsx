import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ChangeOrderStarted event. Not shipped (not exported from index.ts).
export default function ChangeOrderStartedPreview() {
  return (
    <NotificationEmail
      heading={"Change order started"}
      preview={"Change order started"}
      message={"Change order ECO-00042 has started"}
      reference={"ECO-00042"}
      recipientName={"Jane Doe"}
      ctaLabel={"View change order"}
      ctaUrl={"https://app.carbon.ms/x/items/change-order/1/details"}
      details={[
        {
          label: "Status",
          value: "Start"
        }
      ]}
    />
  );
}
