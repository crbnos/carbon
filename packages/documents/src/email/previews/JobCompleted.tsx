import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// JobCompleted event. Not shipped (not exported from index.ts).
export default function JobCompletedPreview() {
  return (
    <NotificationEmail
      heading={"Job completed"}
      preview={"Job completed"}
      message={"Job J00105 is complete!"}
      reference={"J00105"}
      recipientName={"Naveen"}
      ctaLabel={"View job"}
      ctaUrl={"https://app.carbon.ms/x/job/1"}
      details={[
        {
          label: "Part",
          value: "PART-1024"
        },
        {
          label: "Completed",
          value: "25"
        },
        {
          label: "Customer",
          value: "Acme Corporation"
        }
      ]}
    />
  );
}
