import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { itemRevisionStatus, plmReleaseControl } from "../../items.models";

// A released (Production) revision should flow changes through a change order.
// Only `enforce` hard-locks editing; `warn` keeps editing enabled and shows an
// advisory; `off` does nothing.
export type ReleaseLockProps = {
  revisionStatus?: (typeof itemRevisionStatus)[number] | null;
  releaseControl?: (typeof plmReleaseControl)[number];
};

export function getReleaseLockFlags({
  revisionStatus,
  releaseControl
}: ReleaseLockProps) {
  const isProduction = revisionStatus === "Production";
  return {
    isProductionRevision: isProduction && releaseControl !== "off",
    isReleaseLocked: isProduction && releaseControl === "enforce"
  };
}

type ReleaseLockAlertProps = {
  isLocked: boolean;
  className?: string;
};

// Banner for BOM/BOP editors on a released (Production) revision. `isLocked`
// (enforce) renders the hard-lock copy; otherwise (warn) a softer advisory.
const ReleaseLockAlert = ({ isLocked, className }: ReleaseLockAlertProps) => (
  <Alert variant="warning" className={className}>
    <LuTriangleAlert />
    <AlertTitle>
      {isLocked ? (
        <Trans>Released revision is locked</Trans>
      ) : (
        <Trans>Released revision</Trans>
      )}
    </AlertTitle>
    <AlertDescription>
      {isLocked ? (
        <Trans>
          This revision is released (Production). Open a change order to modify
          it.
        </Trans>
      ) : (
        <Trans>
          This revision is released (Production). Changes should normally flow
          through a change order.
        </Trans>
      )}
    </AlertDescription>
  </Alert>
);

export default ReleaseLockAlert;
