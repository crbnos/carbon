import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { CutListLine, CutPattern, CutPatternCut } from "../../types";

type CutListPatternsProps = {
  patterns: CutPattern[];
  lines: CutListLine[];
  unitOfDimension: string;
};

/**
 * One bar per row, drawn to scale: each piece is a block sized by its share of
 * the stock length, the drop is what's left. Reading a cut plan as numbers is
 * how you mis-cut a bar; seeing it is how you don't.
 */
const CutListPatterns = ({
  patterns,
  lines,
  unitOfDimension
}: CutListPatternsProps) => {
  const { t } = useLingui();

  if (patterns.length === 0) return null;

  const lineLabels = new Map(
    lines.map((line) => {
      const item = line.item as {
        readableIdWithRevision?: string | null;
      } | null;
      return [line.id, item?.readableIdWithRevision ?? line.itemId];
    })
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t`Cut plan`}</CardTitle>
        <CardDescription>
          {t`${patterns.length} stock unit(s), in cut order`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {patterns.map((pattern) => {
            const cuts = (pattern.pattern ?? []) as CutPatternCut[];
            const stockLength = Number(pattern.stockLength ?? 0);
            const remnant = Number(pattern.expectedRemnant ?? 0);
            const entity = pattern.trackedEntity as {
              readableId?: string | null;
            } | null;
            const item = pattern.item as {
              readableIdWithRevision?: string | null;
            } | null;

            return (
              <div key={pattern.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">#{pattern.sequence}</Badge>
                    <span className="font-medium">
                      {item?.readableIdWithRevision ?? ""}
                    </span>
                    {entity?.readableId && (
                      <span className="text-muted-foreground">
                        {t`Lot`} {entity.readableId}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {stockLength} {unitOfDimension}
                  </span>
                </div>

                <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
                  {cuts.map((cut, index) => {
                    const share =
                      stockLength > 0
                        ? (cut.pieceLength / stockLength) * 100
                        : 0;
                    return (
                      <div
                        key={`${pattern.id}-${index}`}
                        className="flex items-center justify-center border-r border-background bg-primary/20 text-[10px] tabular-nums overflow-hidden whitespace-nowrap"
                        style={{ width: `${share}%` }}
                        title={`${lineLabels.get(cut.cutListLineId) ?? ""} — ${cut.pieceLength} ${unitOfDimension}`}
                      >
                        {share > 6 ? cut.pieceLength : ""}
                      </div>
                    );
                  })}
                  {remnant > 0 && (
                    <div
                      className="flex items-center justify-center bg-muted text-[10px] text-muted-foreground tabular-nums"
                      style={{
                        width: `${stockLength > 0 ? (remnant / stockLength) * 100 : 0}%`
                      }}
                      title={t`Remnant ${remnant} ${unitOfDimension}`}
                    >
                      {remnant / stockLength > 0.08 ? t`drop` : ""}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    {cuts.length} {t`pieces`}
                  </span>
                  <span className="tabular-nums">
                    {t`Drop`}: {remnant} {unitOfDimension}
                  </span>
                  {pattern.actualRemnant !== null &&
                    pattern.actualRemnant !== undefined && (
                      <span className="tabular-nums">
                        {t`Actual drop`}: {pattern.actualRemnant}{" "}
                        {unitOfDimension}
                      </span>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default CutListPatterns;
