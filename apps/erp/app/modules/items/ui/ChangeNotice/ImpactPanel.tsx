import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

// Compact entry point for the document-first Impact workspace. The old broad
// where-used tree is intentionally not loaded here: its mixed-domain reads had
// no shared coverage or source-access semantics.
export default function ImpactPanel({
  changeNoticeId,
  embedded = false
}: {
  changeNoticeId: string;
  embedded?: boolean;
}) {
  const body = (
    <VStack spacing={2} className="w-full">
      <span className="text-xs text-muted-foreground">
        <Trans>
          Review current purchasing and production exposure with source
          coverage, provenance, and freshness details.
        </Trans>
      </span>
      <Link
        to={path.to.changeNoticeImpact(changeNoticeId)}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <LuExternalLink className="size-4" />
        <Trans>Open Impact workspace</Trans>
      </Link>
    </VStack>
  );

  if (embedded) return body;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Impact</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
