import GetStartedEmail from "../GetStartedEmail";

// Preview fixture — mirrors the 3-days-after-signup nudge sent by the onboard
// job (packages/jobs/.../tasks/onboard.ts, academyUrl is hardcoded there).
// Not shipped (not exported from index.ts).
export default function GetStartedEmailPreview() {
  return (
    <GetStartedEmail
      firstName={"John"}
      academyUrl={"https://learn.carbon.ms"}
    />
  );
}
