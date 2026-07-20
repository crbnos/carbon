import { WeeklyReminderEmail } from "../WeeklyReminderEmail";

// Preview fixture — the weekly outstanding-trainings digest sent by the
// scheduled weekly job. Not shipped (not exported from index.ts).
export default function WeeklyReminderPreview() {
  return (
    <WeeklyReminderEmail
      preview={"You have 3 outstanding trainings"}
      heading={"Your weekly reminders"}
      message={"You have 3 outstanding trainings to complete."}
      recipientName={"Naveen"}
      items={[
        {
          title: "Anti-Bribery",
          status: "Overdue",
          detail: "Mandatory · Annual · 30 minutes",
          url: "https://app.carbon.ms/api/link?event=training-reminder&documentId=ta_1&companyId=co_1"
        },
        {
          title: "Forklift Safety",
          status: "Pending",
          detail: "Mandatory · Once · 1 hour",
          url: "https://app.carbon.ms/api/link?event=training-reminder&documentId=ta_2&companyId=co_1"
        },
        {
          title: "5S Fundamentals",
          status: "Pending",
          detail: "Optional · Once · 45 minutes",
          url: "https://app.carbon.ms/api/link?event=training-reminder&documentId=ta_3&companyId=co_1"
        }
      ]}
      ctaLabel={"View trainings"}
      ctaUrl={"https://app.carbon.ms/x/training"}
    />
  );
}
