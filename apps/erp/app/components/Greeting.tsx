import { Heading } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { useUser } from "~/hooks";

type GreetingProps = ComponentProps<typeof Heading> & {
  /** Hour (0–23) in the company timezone — picks the time-of-day pool. */
  hour: number;
  /** Minute-of-day seed — selects one line within the pool, deterministically. */
  pick: number;
};

/**
 * A time-aware but deliberately non-canned greeting. `hour` and `pick` come from
 * the route loader (computed server-side in the company timezone), so SSR and
 * hydration render the SAME line — no client randomness, no flash on refresh.
 * The greeting follows the company's working day (the app's canonical calendar),
 * so ensure the company timezone is set correctly in settings. `pick` is the
 * minute-of-day: the same within a minute (a refresh doesn't change the line)
 * but rotating each minute for variety. Lines are declarative (never a question)
 * and only some include the name, so it reads like a person, not a template.
 */
export function Greeting({ hour, pick, ...props }: GreetingProps) {
  const { t } = useLingui();
  const user = useUser();

  const greeting = useMemo(() => {
    const name = user.firstName;

    // Hour buckets, each with its own pool. Lines mix time-specific flavor with
    // generic "welcome back" beats — and a few drop the name entirely — so no
    // bucket sounds one-note. Never phrased as a question.
    const pool =
      hour < 4
        ? [
            t`Deep in the small hours, ${name}.`,
            t`The night shift suits you, ${name}.`,
            t`Midnight on the clock, ${name}.`,
            t`Nice and quiet at this hour.`,
            t`Welcome back, ${name}.`
          ]
        : hour < 8
          ? [
              t`Dawn's breaking, ${name}.`,
              t`The early hours, ${name}.`,
              t`Still dark out on the floor.`,
              t`First light, ${name}.`,
              t`Good morning, ${name}.`
            ]
          : hour < 12
            ? [
                t`Good morning, ${name}.`,
                t`Morning, ${name}.`,
                t`Welcome back, ${name}.`,
                t`${name} returns!`,
                t`Let's make it a good one, ${name}.`
              ]
            : hour < 17
              ? [
                  t`Good afternoon, ${name}.`,
                  t`Afternoon, ${name}.`,
                  t`Welcome back, ${name}.`,
                  t`${name} returns!`,
                  t`Hope things are treating you well, ${name}.`
                ]
              : hour < 21
                ? [
                    t`Good evening, ${name}.`,
                    t`Evening, ${name}.`,
                    t`Welcome back, ${name}.`,
                    t`The evening hours, ${name}.`,
                    t`${name} returns!`
                  ]
                : [
                    t`Late in the evening, ${name}.`,
                    t`The night's still young, ${name}.`,
                    t`Welcome back, ${name}.`,
                    t`Quiet on the floor tonight, ${name}.`,
                    t`Good evening, ${name}.`
                  ];

    // `* 7` (coprime with the pool size) spreads consecutive minutes across the
    // pool so the line doesn't march through in order minute by minute.
    return pool[(pick * 7) % pool.length];
  }, [hour, pick, t, user.firstName]);

  return (
    <Heading size="display" {...props}>
      {greeting}
    </Heading>
  );
}
