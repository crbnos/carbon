// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatTimeAgo } from "@carbon/utils/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  Clock,
  CloudUpload,
  type LucideIcon,
  TriangleAlert,
  WifiOff
} from "lucide-react-native";
import { useColorScheme, View } from "react-native";
import type { OutboxSummary } from "~/lib/outbox/policy";
import { themeColor } from "./themeColors";
import { Body, Button, Muted } from "./ui";

/**
 * "3 waiting to send" — the one line that tells an operator their work has not
 * reached the server yet.
 *
 * It renders only while something is unsent, and never while the queue is
 * empty: a banner that is always there is wallpaper, and an operator stops
 * reading it exactly when it starts mattering.
 *
 * One action per state, and the control never disappears between states — a
 * disabled Send now says why it is disabled, in place (design rules:
 * `.claude/skills/carbon-design` → `shop-floor-mes.md`). When rows need a
 * decision the action is Review instead, because resending something that may
 * have partly applied is the operator's call and not the app's.
 */

type Tone = "attention" | "waiting" | "sending";

const TONE_CLASSES: Record<Tone, string> = {
  attention: "border-destructive bg-destructive/10",
  waiting: "border-border bg-muted",
  sending: "border-border bg-muted"
};

export function OutboxBanner({
  summary,
  online,
  onReview,
  onSendNow
}: {
  summary: OutboxSummary;
  /** From `queue.isOnline()`, or whatever the app already tracks. */
  online: boolean;
  /** Opens the outbox list, where Retry, Discard and Confirm live. */
  onReview: () => void;
  /** Omit it to leave the banner informational. */
  onSendNow?: () => void;
}) {
  const { t, i18n } = useLingui();
  const scheme = useColorScheme();

  // Nothing unsent, nothing to say.
  if (summary.total === 0) return null;

  const needsDecision =
    summary.needsAttention > 0 || summary.needsConfirmation > 0;
  const tone: Tone = needsDecision
    ? "attention"
    : summary.sending > 0
      ? "sending"
      : "waiting";

  let Icon: LucideIcon = CloudUpload;
  if (needsDecision) Icon = summary.needsAttention > 0 ? TriangleAlert : Clock;
  else if (!online) Icon = WifiOff;

  const iconColor = needsDecision
    ? themeColor(scheme, "destructive")
    : themeColor(scheme, "mutedForeground");

  // Why Send now cannot be pressed, said in place rather than by vanishing.
  const blockedReason = !online
    ? t`Waiting for a connection`
    : summary.sending > 0
      ? t`Sending now`
      : summary.waiting === 0
        ? t`Nothing left to send`
        : null;

  return (
    <View
      className={`flex-row items-center gap-3 border-b px-4 py-3 ${TONE_CLASSES[tone]}`}
      accessibilityRole="summary"
    >
      <Icon size={20} color={iconColor} />

      <View className="flex-1 gap-0.5">
        <Body
          className={needsDecision ? "font-semibold text-destructive" : ""}
          numberOfLines={2}
        >
          <Headline summary={summary} online={online} />
        </Body>
        {needsDecision ? (
          <NeedsDecisionDetail summary={summary} locale={i18n.locale} />
        ) : blockedReason ? (
          <Muted className="text-sm">{blockedReason}</Muted>
        ) : null}
      </View>

      {needsDecision ? (
        <Button
          variant="secondary"
          onPress={onReview}
          accessibilityLabel={t`Review unsent actions`}
        >
          <Trans>Review</Trans>
        </Button>
      ) : (
        <Button
          variant="secondary"
          onPress={onSendNow}
          disabled={!onSendNow || blockedReason !== null}
          accessibilityLabel={t`Send unsent actions now`}
        >
          <Trans>Send now</Trans>
        </Button>
      )}
    </View>
  );
}

/**
 * The count, with context, in the order that matters to the operator: a
 * refusal first, then a shift-old row, then what is simply in flight.
 */
function Headline({
  summary,
  online
}: {
  summary: OutboxSummary;
  online: boolean;
}) {
  if (summary.needsAttention > 0) {
    return (
      <Plural
        value={summary.needsAttention}
        one="# action needs your attention"
        other="# actions need your attention"
      />
    );
  }
  if (summary.needsConfirmation > 0) {
    return (
      <Plural
        value={summary.needsConfirmation}
        one="# action from an earlier shift needs confirming"
        other="# actions from an earlier shift need confirming"
      />
    );
  }
  if (summary.sending > 0 && summary.waiting === 0) {
    return (
      <Plural
        value={summary.sending}
        one="Sending # action"
        other="Sending # actions"
      />
    );
  }
  // One row can name itself; several can only be counted.
  const label = summary.oldestLabel;
  if (summary.total === 1 && label) {
    return online ? (
      <Trans>{label} is waiting to send</Trans>
    ) : (
      <Trans>Offline · {label} is waiting to send</Trans>
    );
  }
  const waiting = summary.waiting + summary.sending;
  return online ? (
    <Plural
      value={waiting}
      one="# action waiting to send"
      other="# actions waiting to send"
    />
  ) : (
    <Trans>
      Offline ·{" "}
      <Plural
        value={waiting}
        one="# action waiting to send"
        other="# actions waiting to send"
      />
    </Trans>
  );
}

/** What the operator has to decide about, and how old the oldest one is. */
function NeedsDecisionDetail({
  summary,
  locale
}: {
  summary: OutboxSummary;
  locale: string;
}) {
  // A wall-clock instant, formatted through the shared helper — for a row held
  // back from an earlier shift its age IS the point.
  const age = summary.oldestCreatedAt
    ? formatTimeAgo(summary.oldestCreatedAt, locale)
    : "";
  return (
    <Muted className="text-sm" numberOfLines={1}>
      {summary.lanes > 1 ? (
        <Plural
          value={summary.lanes}
          one="# operation affected"
          other="# operations affected"
        />
      ) : (
        (summary.oldestLabel ?? "")
      )}
      {age ? ` · ${age}` : ""}
    </Muted>
  );
}
