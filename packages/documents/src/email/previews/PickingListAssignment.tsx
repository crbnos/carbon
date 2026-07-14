import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// PickingListAssignment event. Not shipped (not exported from index.ts).
export default function PickingListAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Picking list assigned to you"}
      preview={"Picking list assigned to you"}
      message={"Picking List PL-0008 assigned to you"}
      reference={"PL-0008"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/picking-list/1"}
      details={[
        {
          label: "Location",
          value: "Main Plant"
        },
        {
          label: "Due",
          value: "Jul 3, 2026"
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
