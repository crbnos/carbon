// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { federationIssuerValidator } from "@carbon/ee/federation";
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
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import IssuerFields, { type IssuerValues } from "./IssuerFields";

type FederationIssuerFormProps = {
  initialValues: IssuerValues;
  /** An archived issuer is shown read-only: it can no longer change. */
  archived?: boolean;
  onClose: () => void;
};

const FederationIssuerForm = ({
  initialValues,
  archived = false,
  onClose
}: FederationIssuerFormProps) => {
  const permissions = usePermissions();
  const fetcher = useAction();
  const isEditing = initialValues.id !== undefined;
  const isDisabled = archived || !permissions.can("update", "users");

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
        <ValidatedForm
          validator={federationIssuerValidator}
          method="post"
          action={
            isEditing
              ? path.to.federationIssuer(initialValues.id!)
              : path.to.newFederationIssuer
          }
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Issuer</Trans>
              ) : (
                <Trans>Register Issuer</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                An OIDC identity provider whose tokens Carbon accepts. Rules
                name the workloads of an issuer.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            {archived && (
              <Alert variant="warning" className="mb-4">
                <AlertDescription>
                  <Trans>
                    This issuer is archived. It and its rules accept no more
                    tokens, and it can no longer change.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
            {/* A disabled fieldset disables every control inside it. */}
            <fieldset disabled={archived} className="contents">
              <IssuerFields
                initialValues={initialValues}
                isDisabled={isDisabled}
              />
            </fieldset>
          </ModalBody>
          <ModalFooter>
            <HStack>
              {!archived && (
                <Submit isDisabled={isDisabled}>
                  {isEditing ? <Trans>Save</Trans> : <Trans>Register</Trans>}
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

export default FederationIssuerForm;
