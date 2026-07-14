import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// MaintenanceDispatchCreated event. Not shipped (not exported from index.ts).
export default function MaintenanceDispatchCreatedPreview() {
  return (
    <NotificationEmail
      heading={"New maintenance dispatch"}
      preview={"New maintenance dispatch"}
      message={"New maintenance dispatch MD-0012 created"}
      reference={"MD-0012"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/maintenance/1"}
      details={[
        {
          label: "Work center",
          value: "CNC Mill 1"
        },
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
          label: "Created by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
