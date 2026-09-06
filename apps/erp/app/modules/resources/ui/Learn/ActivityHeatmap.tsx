import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { HEATMAP_WEEKS, heatmapBucket } from "~/modules/resources";

type ActivityHeatmapProps = {
  days: Array<{ day: string; xp: number }>;
  /** Today in the company's timezone, "YYYY-MM-DD". */
  today: string;
  weeks?: number;
};

/**
 * A GitHub-style contribution grid, private to the learner.
 *
 * There is no heatmap in `@carbon/react`, and this one is deliberately a plain
 * CSS grid rather than a charting dependency: 182 divs with a token class each,
 * no canvas, no layout measurement, and it themes for free.
 */
const INTENSITY = [
  "bg-muted",
  "bg-primary/10",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/80"
] as const;

const ActivityHeatmap = ({
  days,
  today,
  weeks = HEATMAP_WEEKS
}: ActivityHeatmapProps) => {
  const { t } = useLingui();

  const cells = useMemo(() => {
    const xpByDay = new Map(days.map((d) => [d.day, d.xp]));

    // Walk back to the Sunday that starts the window so columns are weeks.
    const end = new Date(`${today}T00:00:00.000Z`);
    const endDow = end.getUTCDay();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7 - endDow);

    const out: Array<{ day: string; xp: number; future: boolean }> = [];
    for (let i = 0; i < weeks * 7; i += 1) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      out.push({ day: key, xp: xpByDay.get(key) ?? 0, future: key > today });
    }
    return out;
  }, [days, today, weeks]);

  const totalXp = days.reduce((sum, d) => sum + d.xp, 0);
  const activeDays = days.filter((d) => d.xp > 0).length;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={t`Learning activity for the last ${weeks} weeks: ${activeDays} active days, ${totalXp} XP`}
        className="grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto pb-1"
      >
        {cells.map((cell) => (
          <div
            key={cell.day}
            title={cell.future ? undefined : `${cell.day}: ${cell.xp} XP`}
            className={cn(
              "size-[10px] rounded-[2px]",
              cell.future ? "bg-transparent" : INTENSITY[heatmapBucket(cell.xp)]
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">{t`${activeDays} active days`}</span>
        <div className="flex items-center gap-1">
          <span>{t`Less`}</span>
          {INTENSITY.map((className) => (
            <div
              key={className}
              className={cn("size-[10px] rounded-[2px]", className)}
            />
          ))}
          <span>{t`More`}</span>
        </div>
      </div>
    </div>
  );
};

export default ActivityHeatmap;
