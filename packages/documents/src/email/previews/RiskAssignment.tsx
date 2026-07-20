import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// RiskAssignment event. Not shipped (not exported from index.ts).
export default function RiskAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Risk assigned to you"}
      preview={"Risk assigned to you"}
      message={'Risk "Single-source supplier" assigned to you'}
      reference={"Single-source supplier"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/quality/risk/1"}
      details={[
        {
          label: "Type",
          value: "Risk"
        },
        {
          label: "Source",
          value: "Supplier"
        },
        {
          label: "Severity",
          value: "4 / 5"
        },
        {
          label: "Likelihood",
          value: "3 / 5"
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
