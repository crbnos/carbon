import { ExperiencePlaceholder } from "~/components/Layout/ExperiencePlaceholder";

export const handle = { breadcrumb: "Decisions" };

export default function DecisionsRoute() {
  return (
    <ExperiencePlaceholder
      title="Decisions"
      description="A governed workspace for evidence-backed manufacturing decisions."
      nextPhase="the P4 Decision and AI workspace"
    />
  );
}
