import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ChangeOrderDone event. Not shipped (not exported from index.ts).
export default function ChangeOrderDonePreview() {
  return (
    <NotificationEmail
      heading={"Change order complete"}
      preview={"Change order complete"}
      message={"Change order ECO-00042 is complete"}
      reference={"ECO-00042"}
      recipientName={"Jane Doe"}
      ctaLabel={"View change order"}
      ctaUrl={"https://app.carbon.ms/x/items/change-order/1/details"}
      details={[
        {
          label: "Status",
          value: "Done"
        }
      ]}
    />
  );
}
