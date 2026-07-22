import { pageBySlug } from "@carbon/onboarding";
import { HowWeWorkView, LockedPreview } from "@carbon/onboarding/ui";

// Self-serve sees this Guided-plan page as a real-but-dimmed locked preview.
export default function GetStartedHowWeWorkRoute() {
  return (
    <LockedPreview page={pageBySlug("how-we-work")!}>
      <HowWeWorkView />
    </LockedPreview>
  );
}
