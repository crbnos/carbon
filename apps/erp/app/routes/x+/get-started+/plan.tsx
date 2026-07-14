import { PlanView } from "@carbon/onboarding/ui";
import { useNavigate } from "react-router";
import { useScrollToHash } from "~/hooks";
import { path } from "~/utils/path";

// Scroll to (and briefly highlight) the step card linked from the hub's
// "View in project plan" deep link. State + mutations come from
// <HubProvider> in the layout.
export default function GetStartedPlanRoute() {
  const navigate = useNavigate();
  useScrollToHash();

  // In-hub navigation stays in this tab — only external resources (Academy,
  // docs) and Setup Map deep links into ERP screens open new tabs. An anchor id
  // deep-links to the matching Setup Map group (see setup route's scroll hook).
  return (
    <PlanView
      onOpenSetupMap={(anchorId) =>
        navigate(
          `${path.to.getStartedPage("setup")}${anchorId ? `#${anchorId}` : ""}`
        )
      }
    />
  );
}
