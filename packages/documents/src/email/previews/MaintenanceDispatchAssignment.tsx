import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// MaintenanceDispatchAssignment event. Not shipped (not exported from index.ts).
export default function MaintenanceDispatchAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Maintenance dispatch assigned to you"}
      preview={"Maintenance dispatch assigned to you"}
      message={"Maintenance dispatch MD-0012 for CNC Mill 1 assigned to you"}
      reference={"MD-0012"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/maintenance/1"}
      details={[
        {
          label: "Priority",
          value: "High"
        },
        {
          label: "Severity",
          value: "Support Required"
        },
        {
          label: "Status",
          value: "Open"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
