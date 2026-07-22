import { SetupMapView } from "@carbon/onboarding/ui";
import { useScrollToHash } from "~/hooks";
import { useUser } from "~/hooks";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedSetupRoute() {
  // Scroll to (and briefly highlight) the group section deep-linked from a
  // Basics task in the Plan view.
  useScrollToHash();
  const user = useUser();
  const userName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return <SetupMapView userName={userName || user.email} />;
}
