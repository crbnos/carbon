import CompanyDeletionWarningEmail from "../CompanyDeletionWarningEmail";

export default function CompanyDeletionWarningEmailPreview() {
  return (
    <CompanyDeletionWarningEmail
      recipientName={"John"}
      companyName={"Acme Manufacturing"}
      deletionDate={"October 11, 2026"}
      billingUrl={"https://app.carbon.ms/x/settings/billing"}
    />
  );
}
