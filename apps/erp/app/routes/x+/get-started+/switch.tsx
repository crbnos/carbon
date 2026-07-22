import { SwitchView } from "@carbon/onboarding/ui";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuClipboardList, LuFileStack } from "react-icons/lu";
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
      <div className="w-full max-w-3xl mx-auto mb-6 rounded-xl border bg-card px-5 py-4 flex items-center gap-4">
        <LuFileStack className="size-5 text-muted-foreground shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium">
            <Trans>Open orders — paste them, we draft them</Trans>
          </span>
          <span className="text-sm text-muted-foreground">
            <Trans>
              The open POs you're waiting to receive and the customer orders you
              still owe: paste or upload your old system's list, review the
              match, and get draft orders to approve.
            </Trans>
          </span>
        </div>
        <Button variant="secondary" asChild>
          <Link to={path.to.getStartedOpenOrders}>
            <Trans>Start</Trans>
          </Link>
        </Button>
      </div>
      <SwitchView />
    </div>
  );
}
