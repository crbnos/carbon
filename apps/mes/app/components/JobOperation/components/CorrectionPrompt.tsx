// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { triggerCorrectionValidator } from "~/services/models";
import type { CorrectionSuggestion } from "~/services/operations.service";
import { path } from "~/utils/path";

/**
 * Shown after a step result that maps to a correction: the operator starts
 * the correction the result maps to, or carries on with none. A result names
 * its fix, so no other correction is offered. A correction the unit has used
 * its limit number of times can't be started; the unit is scrapped or raised
 * as a quality issue instead.
 */
export function CorrectionPrompt({
  suggestion,
  onClose,
  onScrap,
  onQualityIssue
}: {
  suggestion: CorrectionSuggestion;
  onClose: () => void;
  onScrap?: () => void;
  onQualityIssue?: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ success: boolean }>({
    onSuccess: (data) => {
      if (data?.success) onClose();
    }
  });

  const correction = suggestion.corrections.find(
    (c) => c.id === suggestion.suggestedJobCorrectionId
  );
  const overLimit =
    !!correction &&
    correction.maxAttempts !== null &&
    correction.uses >= correction.maxAttempts;

  return (
    <ValidatedForm
      method="post"
      action={path.to.triggerCorrection}
      validator={triggerCorrectionValidator}
      fetcher={fetcher}
      defaultValues={{
        jobId: suggestion.jobId,
        triggeredAtJobOperationId: suggestion.triggeredAtJobOperationId,
        reason: suggestion.reason,
        quantity: 1,
        trackedEntityId: suggestion.trackedEntityId ?? undefined
      }}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Start a correction?</Trans>
        </ModalTitle>
        <ModalDescription>
          {t`"${suggestion.reason}" calls for a correction on this unit.`}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <Hidden name="jobId" />
        <Hidden name="triggeredAtJobOperationId" />
        <Hidden name="reason" />
        <Hidden name="quantity" />
        <Hidden name="trackedEntityId" />
        <Hidden
          name="jobCorrectionId"
          value={suggestion.suggestedJobCorrectionId}
        />
        <VStack spacing={4}>
          {correction && (
            <div className="flex w-full flex-col rounded-md border p-3">
              <span className="font-medium">{correction.name}</span>
              <span className="text-sm text-muted-foreground">
                {correction.returnTo === "Continue"
                  ? t`Then continues to the next operation`
                  : t`Then re-inspects here`}
                {correction.maxAttempts !== null &&
                  ` · ${t`Used ${correction.uses} of ${correction.maxAttempts}`}`}
              </span>
            </div>
          )}
          {overLimit && (
            <Alert variant="destructive">
              <AlertTitle>
                <Trans>Attempt limit reached</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  This unit has used this correction its limit number of times.
                  Scrap it or raise a quality issue instead.
                </Trans>
              </AlertDescription>
            </Alert>
          )}
          {overLimit && (onScrap || onQualityIssue) && (
            <div className="flex w-full gap-2">
              {onScrap && (
                <Button
                  variant="destructive"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    onScrap();
                  }}
                >
                  <Trans>Scrap unit</Trans>
                </Button>
              )}
              {onQualityIssue && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    onQualityIssue();
                  }}
                >
                  <Trans>Raise quality issue</Trans>
                </Button>
              )}
            </div>
          )}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="lg" onClick={onClose}>
          <Trans>No correction</Trans>
        </Button>
        <Submit
          size="lg"
          isLoading={fetcher.state !== "idle"}
          isDisabled={!correction || overLimit || fetcher.state !== "idle"}
        >
          <Trans>Start correction</Trans>
        </Submit>
      </ModalFooter>
    </ValidatedForm>
  );
}
