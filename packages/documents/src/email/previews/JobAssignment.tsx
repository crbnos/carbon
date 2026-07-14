import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// JobAssignment event. Not shipped (not exported from index.ts).
export default function JobAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Job assigned to you"}
      preview={"Job assigned to you"}
      message={"Job J00105 assigned to you"}
      reference={"J00105"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/job/1"}
      details={[
        {
          label: "Part",
          value: "PART-1024"
        },
        {
          label: "Quantity",
          value: "25"
        },
        {
          label: "Due",
          value: "Jul 10, 2026"
        },
        {
          label: "Customer",
          value: "Acme Corporation"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
