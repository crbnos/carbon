import ChangelogEntryEmail from "../ChangelogEntryEmail";

export default function ChangelogEntryEmailPreview() {
  return (
    <ChangelogEntryEmail
      title={"Finite-capacity scheduling"}
      description={
        "The scheduler now plans against real work-center capacity, with ability-gated operators and an explainable Gantt."
      }
      date={"04 Sep 2026"}
      readUrl={
        "https://docs.carbon.ms/changelog/2026-09-04-finite-capacity-scheduling"
      }
      manageUrl={"https://app.carbon.ms/x/account/notifications"}
    />
  );
}
