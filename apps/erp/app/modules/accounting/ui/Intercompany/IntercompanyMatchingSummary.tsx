import { Badge, Card, CardContent, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { memo } from "react";

type IntercompanyMatchingSummaryProps = {
  unmatched: number;
  matched: number;
  eliminated: number;
};

const IntercompanyMatchingSummary = memo(
  ({ unmatched, matched, eliminated }: IntercompanyMatchingSummaryProps) => {
    return (
      <Card>
        <CardContent className="py-3">
          <HStack spacing={6}>
            <HStack spacing={2}>
              <Badge variant="yellow">{unmatched}</Badge>
              <span className="text-sm text-muted-foreground">
                <Trans>Unmatched</Trans>
              </span>
            </HStack>
            <HStack spacing={2}>
              <Badge variant="green">{matched}</Badge>
              <span className="text-sm text-muted-foreground">
                <Trans>Matched</Trans>
              </span>
            </HStack>
            <HStack spacing={2}>
              <Badge variant="gray">{eliminated}</Badge>
              <span className="text-sm text-muted-foreground">
                <Trans>Eliminated</Trans>
              </span>
            </HStack>
          </HStack>
        </CardContent>
      </Card>
    );
  }
);

IntercompanyMatchingSummary.displayName = "IntercompanyMatchingSummary";
export default IntercompanyMatchingSummary;
