import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// StockTransferAssignment event. Not shipped (not exported from index.ts).
export default function StockTransferAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Stock transfer assigned to you"}
      preview={"Stock transfer assigned to you"}
      message={"Stock Transfer ST-0021 assigned to you"}
      reference={"ST-0021"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/stock-transfer/1"}
      details={[
        {
          label: "Location",
          value: "Main Plant"
        },
        {
          label: "Items",
          value: "6"
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
