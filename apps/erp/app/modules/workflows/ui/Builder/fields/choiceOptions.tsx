import type { ChoiceSelectOption } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuBell, LuMail, LuSlack } from "react-icons/lu";
import { useIntegrations } from "~/hooks/useIntegrations";
import { usePlanGate } from "~/hooks/usePlanGate";

/** Choices the platform delivers whatever the node says — the notify job force-adds the
 * in-app row to every notification, so it is shown ticked and cannot be unticked. */
const LOCKED = new Set(["inApp"]);

export function lockedChoices(choices: readonly string[]): string[] {
  return choices.filter((choice) => LOCKED.has(choice));
}

export type ChoiceOptionResolver = (
  choices: readonly string[]
) => ChoiceSelectOption[];

/**
 * Builds the options for a `multiple` catalog input. Today that is only the notify
 * action's channels, and the whole point of the descriptions is that the notify job
 * skips a channel the company cannot use in SILENCE — the author has to be told here
 * or they never find out at all.
 */
export function useChoiceOptions(): ChoiceOptionResolver {
  const { t } = useLingui();
  const slackConnected = useIntegrations().has("slack");
  const emailGated = usePlanGate({ feature: "EMAIL_NOTIFICATIONS" }).isGated;

  return (choices) =>
    choices.map((value) => {
      switch (value) {
        case "inApp":
          return {
            value,
            title: t`In-app`,
            description: t`Always sent — every notification shows in the bell menu.`,
            icon: <LuBell />,
            disabled: true
          };
        case "email":
          return {
            value,
            title: t`Email`,
            description: emailGated
              ? t`Needs a Business or Partner plan.`
              : t`Sent to each recipient who has email notifications turned on.`,
            icon: <LuMail />,
            disabled: emailGated
          };
        case "slack":
          return {
            value,
            title: t`Slack`,
            description: slackConnected
              ? t`Direct message to each recipient in your Slack workspace.`
              : t`Connect Slack under Settings → Integrations first.`,
            icon: <LuSlack />,
            disabled: !slackConnected
          };
        // A new multi-select input with no wording of its own still renders.
        default:
          return { value, title: value };
      }
    });
}
