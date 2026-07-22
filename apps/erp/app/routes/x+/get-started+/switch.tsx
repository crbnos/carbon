import { SwitchView } from "@carbon/onboarding/ui";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuClipboardList } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedSwitchViewRoute() {
  return (
    <div className="flex flex-col">
      <div className="w-full max-w-3xl mx-auto mb-6 rounded-xl border bg-card px-5 py-4 flex items-center gap-4">
        <LuClipboardList className="size-5 text-muted-foreground shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium">
            <Trans>Opening stock — count it, upload it, we type it</Trans>
          </span>
          <span className="text-sm text-muted-foreground">
            <Trans>
              The weekend before you switch: count the factory on paper, upload
              the filled sheets, review, and post.
            </Trans>
          </span>
        </div>
        <Button variant="secondary" asChild>
          <Link to={path.to.getStartedOpeningStock}>
            <Trans>Start</Trans>
          </Link>
        </Button>
      </div>
      <SwitchView />
    </div>
  );
}
