import { Badge, Button, Input } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuFlame, LuShield, LuShieldCheck } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import {
  ACTIVATION_STREAK_DAYS,
  checkKey,
  flagKey,
  reduceStreak,
  STREAK_FREEZES_PER_JOURNEY,
  USAGE_DAY_COLLECTION
} from "../logic";
import { PageHeader, Panel } from "./primitives";
import { useCheckMap, useFieldMap, useHubActions, useRows } from "./state";

// Live on Carbon — the scoreboard that exists ONLY between cutover and
// activation. The streak is a mirror, not a judge: quiet days are named
// kindly, a freeze absorbs a miss, and progress never goes backward. The
// definition is printed right here in plain words — no hidden judgment.

const LIVE_AT_KEY = "live.liveAt";

interface UsageDayPayload {
  date?: string;
  qualifying?: boolean;
}

// The daily five-minute health check — each line links to the screen that
// fixes it. Computed by the route's loader (labels arrive localized).
export interface HealthCheckItem {
  key: string;
  label: string;
  count: number;
  url: string;
}

export function LiveView({
  healthChecks = []
}: {
  healthChecks?: HealthCheckItem[];
}) {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const usageRows = useRows(USAGE_DAY_COLLECTION);
  const fixits = useRows("fixit");
  const { addRow, toggleFlag } = useHubActions();
  const [relapseText, setRelapseText] = useState("");

  const liveAt = fields.get(LIVE_AT_KEY);

  const streak = useMemo(() => {
    const days = usageRows.flatMap((row) => {
      const payload = row.payload as UsageDayPayload;
      return typeof payload.date === "string"
        ? [{ date: payload.date, qualifying: payload.qualifying === true }]
        : [];
    });
    return reduceStreak(days);
  }, [usageRows]);

  // The weekly relapse question keys off the ISO week so it asks once a week.
  const week = useMemo(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil(
      ((now.getTime() - start.getTime()) / 86_400_000 + start.getUTCDay() + 1) /
        7
    );
    return `${now.getUTCFullYear()}-${weekNumber}`;
  }, []);
  const relapseAnsweredKey = checkKey("live.relapse", week);
  const relapseAnswered = map.get(relapseAnsweredKey) === "1";

  if (!liveAt) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
        <PageHeader
          title={i18n._(PAGE_COPY.live.title)}
          lead={i18n._(PAGE_COPY.live.lead)}
        />
        <Panel>
          <p className="text-sm text-muted-foreground">
            <Trans>
              This page wakes up when you make the switch. After cutover, ten
              straight business days of real usage lands you at Activated — and
              this hub's job is done.
            </Trans>
          </p>
        </Panel>
      </div>
    );
  }

  const freezesUsed = STREAK_FREEZES_PER_JOURNEY - streak.freezesRemaining;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.live.title)}
        lead={i18n._(PAGE_COPY.live.lead)}
      />

      {/* The streak */}
      <Panel>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <LuFlame className="size-10 text-primary" />
            <div>
              <div className="text-3xl font-semibold tabular-nums">
                {streak.streak}
                <span className="text-lg text-muted-foreground">
                  {" "}
                  / {ACTIVATION_STREAK_DAYS}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <Trans>Running on Carbon — business days</Trans>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: STREAK_FREEZES_PER_JOURNEY }).map((_, i) =>
              i < streak.freezesRemaining ? (
                <LuShieldCheck key={i} className="size-6 text-primary" />
              ) : (
                <LuShield key={i} className="size-6 text-muted-foreground/40" />
              )
            )}
            <span className="text-xs text-muted-foreground">
              <Trans>Streak shields left</Trans>
            </span>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {streak.daysOnCarbon}
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>Days on Carbon — only ever climbs</Trans>
            </div>
          </div>
        </div>
        {freezesUsed > 0 && streak.freezeDates.length > 0 ? (
          <p className="text-xs text-muted-foreground mt-3">
            <Trans>
              {streak.freezeDates[streak.freezeDates.length - 1]} was quiet — a
              shield kept your streak.
            </Trans>
          </p>
        ) : null}
      </Panel>

      {/* The definition, in plain words */}
      <Panel title={<Trans>What counts, in plain words</Trans>}>
        <p className="text-sm text-muted-foreground">
          <Trans>
            A day counts when real work happens in Carbon in at least two areas
            of your factory — orders, jobs, purchasing, receiving, the floor,
            shipping, or invoicing. Weekends and your holidays never count
            against you. A quiet weekday uses a shield if you have one;
            otherwise the streak restarts — but your days on Carbon and every
            milestone you've reached stay yours.
          </Trans>
        </p>
      </Panel>

      {/* The daily five-minute health check — a morning-coffee ritual for the
          first two weeks, weekly after that */}
      {healthChecks.some((item) => item.count > 0) ? (
        <Panel title={<Trans>The five-minute health check</Trans>}>
          <ul className="flex flex-col gap-2">
            {healthChecks
              .filter((item) => item.count > 0)
              .map((item) => (
                <li key={item.key}>
                  <a
                    href={item.url}
                    className="flex items-center justify-between gap-4 text-sm hover:text-primary transition-colors"
                  >
                    <span>{item.label}</span>
                    <Badge variant="destructive" className="tabular-nums">
                      {item.count}
                    </Badge>
                  </a>
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

      {/* The relapse question — silent regression gets caught while it's one
          order, not one department */}
      <Panel title={<Trans>Once a week, one click</Trans>}>
        {relapseAnswered ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <LuCheck className="size-4 text-primary" />
            <Trans>Answered this week. See you next Monday.</Trans>
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">
              <Trans>Did anything happen outside Carbon this week?</Trans>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleFlag(relapseAnsweredKey, "check", true)}
              >
                <Trans>No — everything ran in Carbon</Trans>
              </Button>
              <Input
                className="flex-1 min-w-48"
                value={relapseText}
                onChange={(e) => setRelapseText(e.target.value)}
                placeholder={t`Yes — what was it?`}
              />
              <Button
                size="sm"
                isDisabled={!relapseText.trim()}
                onClick={() => {
                  addRow("fixit", { label: relapseText.trim() });
                  toggleFlag(relapseAnsweredKey, "check", true);
                  setRelapseText("");
                }}
              >
                <Trans>Make it a fix-it task</Trans>
              </Button>
            </div>
          </div>
        )}

        {fixits.length > 0 ? (
          <ul className="flex flex-col gap-2 mt-4">
            {fixits.map((row) => {
              const label =
                typeof row.payload.label === "string" ? row.payload.label : "";
              const key = flagKey(`fixit.${row.id}`);
              const fixed = map.get(key) === "1";
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className={fixed ? "line-through opacity-60" : ""}>
                    {label}
                  </span>
                  <Button
                    variant={fixed ? "primary" : "secondary"}
                    size="sm"
                    leftIcon={fixed ? <LuCheck /> : undefined}
                    onClick={() => toggleFlag(key, "scopeFlag", !fixed)}
                  >
                    {fixed ? <Trans>Fixed</Trans> : <Trans>Open</Trans>}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Panel>

      {streak.activatedOn ? (
        <Panel>
          <div className="flex items-center gap-3">
            <Badge>
              <Trans>Activated</Trans>
            </Badge>
            <p className="text-sm">
              <Trans>
                Ten straight days on {streak.activatedOn}. Your factory runs on
                Carbon.
              </Trans>
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
