import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// JobOperationAssignment event. Not shipped (not exported from index.ts).
export default function JobOperationAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Job operation assigned to you"}
      preview={"Job operation assigned to you"}
      message={"New job operation assigned to you on J00105"}
      reference={"J00105"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/job/1"}
      details={[
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
          value: "Ready"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
