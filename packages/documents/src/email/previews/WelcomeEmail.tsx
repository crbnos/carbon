import WelcomeEmail from "../WelcomeEmail";

// Preview fixture — the signup welcome email sent by the onboard job
// (packages/jobs/.../tasks/onboard.ts). The template takes no props; this
// wrapper exists so the email shows up alongside the rest in `email dev`.
// Not shipped (not exported from index.ts).
export default function WelcomeEmailPreview() {
  return <WelcomeEmail />;
}
