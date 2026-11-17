// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { useFetcher } from "react-router";
import type {
  action as recalculateAction,
  loader as shipByLoader
} from "~/routes/x+/sales-order+/$orderId.ship-by-dates";
import { path } from "~/utils/path";

/**
 * After a change to the order's arrive-by date, shipping method or ship-to:
 * `check()` reads the ship-by plan, and when 1 or more open lines would move,
 * `prompt` asks "Recalculate the ship date on N lines?". Carbon never moves
 * a line without a yes.
 */
export function useShipByRecalculatePrompt(salesOrderId: string) {
  const { t } = useLingui();
  const plan = useFetcher<typeof shipByLoader>();
  const [asked, setAsked] = useState(false);
  const recalculate = useAction<typeof recalculateAction>({
    onSuccess: () => toast.success(t`Recalculated the ship dates`),
    onSettled: () => setAsked(false)
  });

  const check = useCallback(() => {
    setAsked(true);
    plan.load(path.to.salesOrderShipByDates(salesOrderId));
  }, [plan, salesOrderId]);

  const changes = plan.data?.data?.changes ?? 0;
  const open = asked && plan.state === "idle" && changes > 0;

  const prompt = (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setAsked(false);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Recalculate ship dates</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">
            <Plural
              value={changes}
              one="Recalculate the ship date on # line from the promised date and the transit days?"
              other="Recalculate the ship date on # lines from the promised date and the transit days?"
            />
          </p>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="secondary" onClick={() => setAsked(false)}>
              <Trans>Keep dates</Trans>
            </Button>
            <Button
              isLoading={recalculate.isPending}
              isDisabled={recalculate.isPending}
              onClick={() =>
                recalculate.submit(null, {
                  method: "post",
                  action: path.to.salesOrderShipByDates(salesOrderId)
                })
              }
            >
              <Trans>Recalculate</Trans>
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );

  return { check, prompt };
}
