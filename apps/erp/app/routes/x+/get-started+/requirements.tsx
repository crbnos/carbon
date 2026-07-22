import { pageBySlug } from "@carbon/onboarding";
import { LockedPreview, RequirementsView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout.
// Self-serve sees this Guided-plan page as a real-but-dimmed locked preview.
export default function GetStartedRequirementsRoute() {
  return (
    <LockedPreview page={pageBySlug("requirements")!}>
      <RequirementsView />
    </LockedPreview>
  );
}
