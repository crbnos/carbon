import { pageBySlug } from "@carbon/onboarding";
import { LockedPreview, TeamView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout.
// Self-serve sees this Guided-plan page as a real-but-dimmed locked preview.
export default function GetStartedTeamRoute() {
  return (
    <LockedPreview page={pageBySlug("team")!}>
      <TeamView />
    </LockedPreview>
  );
}
