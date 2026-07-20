import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// TrainingAssignment event. Not shipped (not exported from index.ts).
export default function TrainingAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Training assigned to you"}
      preview={"Training assigned to you"}
      message={'Training "Anti-Bribery" assigned to you'}
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
          label: "Frequency",
          value: "Annual"
        },
        {
          label: "Duration",
          value: "30 minutes"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
