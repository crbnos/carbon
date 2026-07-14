import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// NonConformanceAssignment event. Not shipped (not exported from index.ts).
export default function NonConformanceAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Issue assigned to you"}
      preview={"Issue assigned to you"}
      message={"Issue NCR-0003 assigned to you"}
      reference={"NCR-0003"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/issue/1"}
      details={[
        {
          label: "Priority",
          value: "High"
        },
        {
          label: "Status",
          value: "In Progress"
        },
        {
          label: "Due",
          value: "Jul 5, 2026"
        },
        {
          label: "Location",
          value: "Main Plant"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
