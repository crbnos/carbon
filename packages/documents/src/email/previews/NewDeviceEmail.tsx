import NewDeviceEmail from "../NewDeviceEmail";

export default function NewDeviceEmailPreview() {
  return (
    <NewDeviceEmail
      recipientName={"Jane Doe"}
      signedInAt={"Sep 18, 2026, 8:17:46 PM UTC"}
      ipAddress={"203.0.113.42"}
      location={"Delhi, IN"}
      browser={"Chrome on macOS"}
      securityUrl={"https://app.carbon.ms/x/account/security"}
    />
  );
}
