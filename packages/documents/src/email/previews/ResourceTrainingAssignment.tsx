import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ResourceTrainingAssignment event. Not shipped (not exported from index.ts).
export default function ResourceTrainingAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"New training available"}
      preview={"New training available"}
      message={'New training available: "Anti-Bribery"'}
      reference={"Anti-Bribery"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/training/1"}
      details={[
        {
          label: "Type",
          value: "Mandatory"
        },
        {
          label: "Status",
          value: "Active"
        },
        {
          label: "Version",
          value: "v1"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
