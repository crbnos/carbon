import MfaRequiredEmail from "../MfaRequiredEmail";

export default function MfaRequiredEmailPreview() {
  return (
    <MfaRequiredEmail
      recipientName={"John Doe"}
      companyName={"Acme Manufacturing"}
      setupUrl={"https://app.carbon.ms/x/account/security"}
    />
  );
}
