import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// SuggestionResponse event. Not shipped (not exported from index.ts).
export default function SuggestionResponsePreview() {
  return (
    <NotificationEmail
      heading={"New suggestion submitted"}
      preview={"New suggestion submitted"}
      message={"New suggestion submitted by Jane Doe"}
      recipientName={"Naveen"}
      ctaLabel={"View suggestion"}
      ctaUrl={"https://app.carbon.ms/x/suggestions"}
      details={[
        {
          label: "Suggestion",
          value: "Add a keyboard shortcut to duplicate a job"
        },
        {
          label: "Page",
          value: "/x/job/J00105"
        }
      ]}
    />
  );
}
