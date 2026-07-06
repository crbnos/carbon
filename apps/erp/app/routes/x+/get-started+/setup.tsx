import { SetupMapView } from "@carbon/onboarding/ui";
import { useScrollToHash } from "~/hooks";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedSetupRoute() {
  // Scroll to (and briefly highlight) the group section deep-linked from a
  // Configure task in the Plan view.
  useScrollToHash();

  return <SetupMapView />;
}
