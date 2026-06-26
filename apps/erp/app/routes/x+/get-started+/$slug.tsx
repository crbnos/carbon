import { pageBySlug } from "@carbon/onboarding";
import { PlaceholderPage } from "@carbon/onboarding/ui";
import { useParams } from "react-router";

// Catch-all for hub pages not yet built (everything past Start Here in P1).
// A real route file (e.g. plan.tsx) takes precedence as each page ships.
export default function GetStartedPlaceholderRoute() {
  const { slug } = useParams();
  const page = slug ? pageBySlug(slug) : undefined;
  return <PlaceholderPage title={page?.title ?? "Implementation Hub"} />;
}
