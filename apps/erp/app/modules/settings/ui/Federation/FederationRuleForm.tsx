// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getBrowserEnv } from "@carbon/auth";
import { federationRuleValidator } from "@carbon/ee/federation";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
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
import { Trans } from "@lingui/react/macro";
import { Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  type IssuerOption,
  RuleFields,
  RulePermissions,
  type RuleValues
} from "./RuleFields";
import {
  type ExchangeAttempt,
  RecentExchanges,
  UsageExample
} from "./UsageExample";

type FederationRuleFormProps = {
  initialValues: RuleValues;
  issuers: IssuerOption[];
  companyId?: string;
  existingScopes?: Record<string, string[]> | null;
  existingClaims?: Record<string, string> | null;
  /** On edit: the saved rule's issuer, for its usage example. */
  savedIssuer?: IssuerOption;
  /** On edit: the rule's latest exchange attempts. */
  exchanges?: ExchangeAttempt[];
  /** An archived rule is shown read-only: it can no longer change. */
  archived?: boolean;
  onClose: () => void;
};

const FederationRuleForm = ({
  initialValues,
  issuers,
  companyId,
  existingScopes,
  existingClaims,
  savedIssuer,
  exchanges,
  archived = false,
  onClose
}: FederationRuleFormProps) => {
  const permissions = usePermissions();
  const fetcher = useAction();
  const { ERP_URL } = getBrowserEnv();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = archived || !permissions.can("update", "users");

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          validator={federationRuleValidator}
          method="post"
          action={
            isEditing
              ? path.to.federationRule(initialValues.id!)
              : path.to.newFederationRule
          }
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Federation Rule</Trans>
              ) : (
                <Trans>New Federation Rule</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                A workload that presents a matching token from the issuer gets a
                short-lived API key with these scopes.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              {archived && (
                <Alert variant="warning">
                  <AlertDescription>
                    <Trans>
                      This rule is archived. It accepts no more tokens, and it
                      can no longer change.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}
              {/* A disabled fieldset disables every control inside it. */}
              <fieldset disabled={archived} className="contents">
                <RuleFields
                  initialValues={initialValues}
                  issuers={issuers}
                  existingClaims={existingClaims}
                  isDisabled={isDisabled}
                />
                <RulePermissions
                  companyId={companyId}
                  existingScopes={existingScopes}
                  isDisabled={isDisabled}
                />
              </fieldset>
              {isEditing && savedIssuer && (
                <UsageExample
                  target={{
                    ruleId: initialValues.id!,
                    audience: initialValues.audience,
                    provider: savedIssuer.provider,
                    issuer: savedIssuer.issuer
                  }}
                  erpUrl={ERP_URL}
                />
              )}
              {exchanges && (
                <VStack spacing={2} className="w-full">
                  <span className="text-sm font-medium">
                    <Trans>Recent exchanges</Trans>
                  </span>
                  <RecentExchanges exchanges={exchanges} />
                </VStack>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              {!archived && (
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              )}
              <Button size="md" variant="solid" onClick={() => onClose()}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default FederationRuleForm;
