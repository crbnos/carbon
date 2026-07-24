import ImplementationHubEmail from "../ImplementationHubEmail";

// Preview fixture — mirrors the email sent to company admins when a company
// enrolls in the implementation hub (apps/erp/.../get-started+/enroll.tsx).
// hubUrl is the one required prop, so the bare template can't render on its
// own. Not shipped (not exported from index.ts).
export default function ImplementationHubEmailPreview() {
  return (
    <ImplementationHubEmail
      recipientName={"John Doe"}
      hubUrl={"https://app.carbon.ms/x/get-started"}
    />
  );
}
