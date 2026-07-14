import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// JobOperationMessage event. Not shipped (not exported from index.ts).
export default function JobOperationMessagePreview() {
  return (
    <NotificationEmail
      heading={"New job operation message"}
      preview={"New job operation message"}
      message={"New message on J00105 operation: Deburr all edges"}
      reference={"J00105"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/job/1"}
      details={[
        {
          label: "Message",
          value: "Deburr all edges"
        },
        {
          label: "Work center",
          value: "CNC Mill 1"
        },
        {
          label: "Due",
          value: "Jul 8, 2026"
        },
        {
          label: "Status",
          value: "In Progress"
        }
      ]}
    />
  );
}
