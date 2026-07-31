import VerificationEmail from "../VerificationEmail";

export default function VerificationEmailPreview() {
  return (
    <VerificationEmail
      email={"john.doe@tombstone.ms"}
      verificationCode={"482913"}
    />
  );
}
