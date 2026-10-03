// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { Check, Lock, Play } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { HeroButton } from "~/components/HeroButton";
import { Muted } from "~/components/ui";
import {
  commandMessage,
  errorDetails,
  isBlocked,
  needsAcknowledgement,
  useSetPickingListStatus
} from "./commands";
import {
  nextStatusAction,
  type UnresolvedLine,
  unresolvedLinesFrom
} from "./logic";

/**
 * The list's one dominant action, and the three ways finishing can go.
 *
 * Start is emerald and Finish is neutral, matching web MES's own emphasis:
 * starting a list is the "go" action, finishing it is a commitment that may
 * need answering for, and a green Finish invites the tap that skips the
 * shortfall question.
 *
 * **A locked list keeps its control, disabled, with the reason.** Web MES
 * returns null for a locked list and the buttons simply vanish; the
 * shop-floor rules forbid that here. A kitter who cannot find Finish assumes
 * the tablet is broken and goes looking for a browser; one who reads "reopen
 * this from the ERP" knows the list is already closed and who can reopen it.
 *
 * The two policy outcomes of Finish are both 409s and are NOT the same thing:
 *
 *   - `needs_acknowledgement` (policy `warn`) — the shortfall is named, the
 *     operator confirms, and the retry carries `acknowledged: true`.
 *   - `blocked` (policy `error`) — final. The material is named in the toast
 *     and there is nothing to retry; the kitter has to go and pick it.
 *
 * Neither decision is made here. `setPickingListStatus` on the server owns the
 * policy and fails closed when it cannot read it, which is the only place an
 * `acknowledged: true` body cannot argue with.
 */
export function PickingStatusBar({
  listId,
  status,
  lines,
  resolved
}: {
  listId: string;
  status: string | null | undefined;
  lines: number;
  resolved: number;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const setStatus = useSetPickingListStatus(listId);
  const [acknowledge, setAcknowledge] = useState<UnresolvedLine[] | null>(null);

  const action = nextStatusAction(status);

  const submit = async (acknowledged: boolean) => {
    if (!action) return;
    try {
      const result = await setStatus.mutateAsync({
        status: action.status,
        ...(acknowledged ? { acknowledged: true } : {})
      });
      setAcknowledge(null);
      // The status the SERVER chose, not the one that was asked for: a finish
      // with an acknowledged shortfall lands on Partial, and telling the
      // kitter it completed would be a lie they find out about later.
      toast.success(
        result.status === "In Progress"
          ? t`Picking started`
          : t`Picking list ${result.status}`
      );
    } catch (error) {
      if (needsAcknowledgement(error)) {
        setAcknowledge(unresolvedLinesFrom(errorDetails(error)));
        return;
      }
      if (isBlocked(error)) {
        const unresolved = unresolvedLinesFrom(errorDetails(error));
        toast.error(
          unresolved.length
            ? t`${commandMessage(error, t`Some material is still unpicked.`)} Still unpicked: ${unresolved
                .map((line) => line.itemName)
                .join(", ")}`
            : commandMessage(error, t`Some material is still unpicked.`)
        );
        return;
      }
      toast.error(commandMessage(error, t`Could not update this list`));
    }
  };

  return (
    <>
      <View className="items-center gap-3">
        <Muted className="text-center text-sm">
          {t`${resolved} of ${lines} lines`}
        </Muted>

        {action ? (
          <HeroButton
            icon={action.kind === "start" ? Play : Check}
            label={action.kind === "start" ? t`Start` : t`Finish`}
            tone={action.kind === "start" ? "start" : "neutral"}
            onPress={() => void submit(false)}
            loading={setStatus.isPending}
          />
        ) : (
          <HeroButton
            icon={Lock}
            label={t`Finish`}
            tone="neutral"
            onPress={() => undefined}
            disabled
            disabledReason={t`This list is ${
              status ?? ""
            }. Completed lists are reopened from the ERP.`}
          />
        )}
      </View>

      <ConfirmDialog
        open={acknowledge !== null}
        title={t`Finish with material unpicked?`}
        description={t`These items still have material to pick. Finishing now marks the list Partial.`}
        // Named, not counted: "3 lines short" is not something a kitter can
        // check, and the point of the question is that they look at the list
        // and decide whether the shortfall is real.
        affected={(acknowledge ?? []).map(
          (line) =>
            `${line.itemName} — ${t`${formatQuantity(
              line.outstanding,
              locale
            )} short`}`
        )}
        confirmLabel={t`Acknowledge & finish`}
        cancelLabel={t`Keep picking`}
        pending={setStatus.isPending}
        onConfirm={() => void submit(true)}
        onCancel={() => setAcknowledge(null)}
      />
    </>
  );
}
