import VerificationEmail from "../VerificationEmail";

// Preview fixture — mirrors the login verification code sent by
// packages/auth/src/services/verification.server.ts. Not shipped (not
// exported from index.ts).
export default function VerificationEmailPreview() {
  return (
    <VerificationEmail
      email={"john.doe@tombstone.ms"}
      verificationCode={"482913"}
    />
  );
}
