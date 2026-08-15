import { ExperiencePlaceholder } from "~/components/Layout/ExperiencePlaceholder";

export const handle = { breadcrumb: "Exceptions" };

export default function ExceptionsRoute() {
  return (
    <ExperiencePlaceholder
      title="Exceptions"
      description="A governed workspace for unresolved manufacturing exceptions."
      nextPhase="the P3 Exception Center"
    />
  );
}
