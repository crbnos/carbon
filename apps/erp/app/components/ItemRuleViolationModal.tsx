import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import type { Violation } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuOctagonAlert, LuTriangleAlert } from "react-icons/lu";

type RuleNameMap = Record<string, string>;

type ItemRuleViolationModalProps = {
  violations: Violation[];
  ruleNames?: RuleNameMap;
  onCancel: () => void;
  onAcknowledge: () => void;
  isSubmitting?: boolean;
};

export default function ItemRuleViolationModal({
  violations,
  ruleNames,
  onCancel,
  onAcknowledge,
  isSubmitting
}: ItemRuleViolationModalProps) {
  const { t } = useLingui();

  const { errors, warns, hasError, onlyWarns } = useMemo(() => {
    const errs: Violation[] = [];
    const wrns: Violation[] = [];
    for (const v of violations) {
      (v.severity === "error" ? errs : wrns).push(v);
    }
    return {
      errors: errs,
      warns: wrns,
      hasError: errs.length > 0,
      onlyWarns: errs.length === 0 && wrns.length > 0
    };
  }, [violations]);

  if (violations.length === 0) return null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <span className="flex items-center gap-2">
              {hasError ? (
                <LuOctagonAlert className="text-destructive h-5 w-5" />
              ) : (
                <LuTriangleAlert className="text-amber-500 h-5 w-5" />
              )}
              <Trans>Rule Violation</Trans>
            </span>
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <div className="flex flex-col gap-4 text-sm">
            {errors.length > 0 && (
              <ViolationGroup
                title={t`Errors`}
                violations={errors}
                ruleNames={ruleNames}
                tone="error"
              />
            )}
            {warns.length > 0 && (
              <ViolationGroup
                title={t`Warnings`}
                violations={warns}
                ruleNames={ruleNames}
                tone="warn"
              />
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant={hasError ? "destructive" : "solid"}
            onClick={onAcknowledge}
            isDisabled={hasError || isSubmitting}
            isLoading={isSubmitting}
          >
            {onlyWarns ? (
              <Trans>Acknowledge & continue</Trans>
            ) : (
              <Trans>Confirm</Trans>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ViolationGroup({
  title,
  violations,
  ruleNames,
  tone
}: {
  title: string;
  violations: Violation[];
  ruleNames?: RuleNameMap;
  tone: "error" | "warn";
}) {
  const Icon = tone === "error" ? LuOctagonAlert : LuTriangleAlert;
  const colorClass = tone === "error" ? "text-destructive" : "text-amber-500";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
        {title} · {violations.length}
      </p>
      <ul className="flex flex-col gap-2">
        {violations.map((v, i) => (
          <li
            key={`${v.ruleId}-${i}`}
            className="flex items-start gap-2 border border-border rounded-md px-3 py-2"
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${colorClass}`} />
            <div className="flex flex-col">
              <span className="font-medium">
                {ruleNames?.[v.ruleId] ?? v.ruleId}
              </span>
              <span className="text-muted-foreground text-xs">{v.message}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
