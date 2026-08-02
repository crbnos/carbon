import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { intercompanyDifferenceKinds } from "../../accounting.models";

type IntercompanyDifferenceKindProps = {
  differenceKind?: (typeof intercompanyDifferenceKinds)[number] | null;
};

// Small badge shown next to a matched intercompany transaction when the pair
// matched on something other than an exact base amount — an FX drift or a
// within-tolerance rounding difference absorbed at match time.
const IntercompanyDifferenceKind = ({
  differenceKind
}: IntercompanyDifferenceKindProps) => {
  switch (differenceKind) {
    case "FX":
      return (
        <Badge variant="blue">
          <Trans>FX</Trans>
        </Badge>
      );
    case "Tolerance":
      return (
        <Badge variant="yellow">
          <Trans>Tolerance</Trans>
        </Badge>
      );
    default:
      return null;
  }
};

export default IntercompanyDifferenceKind;
