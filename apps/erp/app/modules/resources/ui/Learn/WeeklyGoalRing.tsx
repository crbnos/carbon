import { useLingui } from "@lingui/react/macro";
import { LuFlame } from "react-icons/lu";

type WeeklyGoalRingProps = {
  weekXp: number;
  goalXp: number;
  streak: number;
  size?: number;
};

/**
 * The weekly goal, as a ring.
 *
 * The unit is a WEEK, not a day: a daily streak in a workday product punishes
 * weekends and holidays, which is why GitHub removed daily streaks outright.
 * Missing this week cannot break the streak — the week is not over yet.
 */
const WeeklyGoalRing = ({
  weekXp,
  goalXp,
  streak,
  size = 132
}: WeeklyGoalRingProps) => {
  const { t } = useLingui();

  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goalXp <= 0 ? 0 : Math.min(weekXp / goalXp, 1);
  const dash = circumference * ratio;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={t`${weekXp} of ${goalXp} XP this week`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            className="stroke-primary transition-[stroke-dasharray] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums leading-none">
            {weekXp}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t`of ${goalXp} XP`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <LuFlame
          className={streak > 0 ? "text-primary" : "text-muted-foreground"}
        />
        <span className="tabular-nums font-medium">{streak}</span>
        <span className="text-muted-foreground">
          {streak === 1 ? t`week streak` : t`week streak`}
        </span>
      </div>
    </div>
  );
};

export default WeeklyGoalRing;
