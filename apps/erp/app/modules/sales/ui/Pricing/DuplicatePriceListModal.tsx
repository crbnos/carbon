// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  ChoiceCardGroup,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Customer, CustomerType, Hidden } from "~/components/Form";
import { path } from "~/utils/path";
import { duplicatePriceListValidator } from "../../sales.models";

type ScopeType = "customer" | "customerType";

type DuplicatePriceListModalProps = {
  sourceScope: { customerId?: string; customerTypeId?: string };
  overrideIds?: string[];
  onClose: () => void;
};

export function DuplicatePriceListModal({
  sourceScope,
  overrideIds,
  onClose
}: DuplicatePriceListModalProps) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    if (prevState.current === "loading" && fetcher.state === "idle") {
      onClose();
    }
    prevState.current = fetcher.state;
  }, [fetcher.state, onClose]);

  const [scopeType, setScopeType] = useState<ScopeType>("customer");
  const [conflictStrategy, setConflictStrategy] = useState<
    "skip" | "overwrite"
  >("skip");

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {overrideIds ? (
              <Trans>Duplicate Item</Trans>
            ) : (
              <Trans>Duplicate Price List</Trans>
            )}
          </ModalTitle>
          <ModalDescription>
            {overrideIds ? (
              <Trans>Copy this item's pricing to another scope.</Trans>
            ) : (
              <Trans>
                Copy all items and pricing to another customer or type.
              </Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          validator={duplicatePriceListValidator}
          fetcher={fetcher}
          action={path.to.duplicatePriceList}
          method="post"
          defaultValues={{
            sourceCustomerId: sourceScope.customerId ?? "",
            sourceCustomerTypeId: sourceScope.customerTypeId ?? "",
            targetCustomerId: "",
            targetCustomerTypeId: "",
            conflictStrategy: "skip",
            overrideIds: overrideIds ? JSON.stringify(overrideIds) : undefined
          }}
        >
          <Hidden name="sourceCustomerId" />
          <Hidden name="sourceCustomerTypeId" />
          <Hidden name="conflictStrategy" value={conflictStrategy} />
          {overrideIds && (
            <Hidden name="overrideIds" value={JSON.stringify(overrideIds)} />
          )}
          <ModalBody>
            <VStack spacing={4}>
              <ChoiceCardGroup<ScopeType>
                label={t`Duplicate To`}
                value={scopeType}
                onChange={setScopeType}
                options={[
                  {
                    value: "customer",
                    title: t`Specific Customer`,
                    description: t`Copy pricing to a single customer`
                  },
                  {
                    value: "customerType",
                    title: t`Customer Type`,
                    description: t`Copy pricing to all customers of a type`
                  }
                ]}
              />

              {scopeType === "customer" && (
                <>
                  <Customer
                    name="targetCustomerId"
                    label={t`Customer`}
                    exclude={
                      sourceScope.customerId
                        ? [sourceScope.customerId]
                        : undefined
                    }
                  />
                  <Hidden name="targetCustomerTypeId" value="" />
                </>
              )}

              {scopeType === "customerType" && (
                <>
                  <CustomerType
                    name="targetCustomerTypeId"
                    label={t`Customer Type`}
                    exclude={
                      sourceScope.customerTypeId
                        ? [sourceScope.customerTypeId]
                        : undefined
                    }
                  />
                  <Hidden name="targetCustomerId" value="" />
                </>
              )}

              <ChoiceCardGroup<"skip" | "overwrite">
                label={t`If items already exist`}
                value={conflictStrategy}
                onChange={setConflictStrategy}
                options={[
                  {
                    value: "skip",
                    title: t`Skip Existing`,
                    description: t`Keep existing pricing, only add new items`
                  },
                  {
                    value: "overwrite",
                    title: t`Overwrite Existing`,
                    description: t`Replace existing pricing with source values`
                  }
                ]}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button type="submit" isLoading={isSubmitting}>
                <Trans>Duplicate</Trans>
              </Button>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
