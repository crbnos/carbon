import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ProcedureAssignment event. Not shipped (not exported from index.ts).
export default function ProcedureAssignmentPreview() {
  return (
    <NotificationEmail
      heading={"Procedure assigned to you"}
      preview={"Procedure assigned to you"}
      message={"Procedure Calibration SOP version 3 assigned to you"}
      reference={"Calibration SOP"}
      recipientName={"Naveen"}
      ctaLabel={"View details"}
      ctaUrl={"https://app.carbon.ms/x/procedure/1"}
      details={[
        {
          label: "Version",
          value: "v3"
        },
        {
          label: "Status",
          value: "Active"
        },
        {
          label: "Process",
          value: "Final Inspection"
        },
        {
          label: "Assigned by",
          value: "Tom Sawyer"
        }
      ]}
    />
  );
}
