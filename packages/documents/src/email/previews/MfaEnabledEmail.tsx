import MfaEnabledEmail from "../MfaEnabledEmail";

export default function MfaEnabledEmailPreview() {
  return (
    <MfaEnabledEmail
      recipientName={"Jane Doe"}
      securityUrl={"https://app.carbon.ms/x/account/security"}
    />
  );
}
