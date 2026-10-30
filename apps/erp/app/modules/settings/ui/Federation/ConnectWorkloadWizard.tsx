// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getBrowserEnv } from "@carbon/auth";
import {
  FEDERATION_LIMITS,
  FEDERATION_PRESETS,
  type FederationIssuerForm,
  type FederationProvider,
  federationIssuerValidator,
  federationProviders,
  federationRuleValidator
} from "@carbon/ee/federation";
import { useFormContext, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LuCircleCheck, LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import IssuerFields, { issuerValuesFor } from "./IssuerFields";
import {
  type IssuerOption,
  RuleFields,
  RulePermissions,
  ruleValuesFor
} from "./RuleFields";
import {
  type ExchangeAttempt,
  RecentExchanges,
  UsageExample
} from "./UsageExample";

type Step = "issuer" | "rule" | "target" | "test";
const STEPS: Step[] = ["issuer", "rule", "target", "test"];

/** The rule fields on the Federation rule step; Next checks only these. */
const RULE_STEP_FIELDS = [
  "name",
  "description",
  "audience",
  "subject",
  "claimConditions",
  "tokenLifetimeMinutes"
];

type CreatedRule = { id: string; audience: string };

type ConnectWorkloadWizardProps = {
  issuers: IssuerOption[];
  companyId?: string;
  onClose: () => void;
  /** Leaves the wizard on the rule it created. */
  onDone: (ruleId: string) => void;
};

/**
 * Connect workload: choose or register an issuer, name the workload, give its
 * keys their scopes, then wait for its first exchange. Each step writes
 * through the same actions as the Issuers and Rules tabs.
 */
export default function ConnectWorkloadWizard({
  issuers,
  companyId,
  onClose,
  onDone
}: ConnectWorkloadWizardProps) {
  const { t } = useLingui();
  const [step, setStep] = useState<Step>("issuer");
  const [issuer, setIssuer] = useState<IssuerOption | null>(null);
  const [rule, setRule] = useState<CreatedRule | null>(null);

  const titles: Record<Step, string> = {
    issuer: t`Issuer`,
    rule: t`Federation rule`,
    target: t`Target`,
    test: t`Test`
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Connect workload</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Let a CI job or cloud workload exchange its own token for a
              short-lived Carbon API key, with no key to store.
            </Trans>
          </ModalDescription>
          <StepIndicator
            steps={STEPS.map((value) => titles[value])}
            current={STEPS.indexOf(step)}
          />
        </ModalHeader>
        {step === "issuer" && (
          <IssuerStep
            issuers={issuers}
            onChosen={(chosen) => {
              setIssuer(chosen);
              setStep("rule");
            }}
            onClose={onClose}
          />
        )}
        {(step === "rule" || step === "target") && issuer && (
          <RuleSteps
            step={step}
            issuer={issuer}
            issuers={issuers}
            companyId={companyId}
            onStep={setStep}
            onCreated={(created) => {
              setRule(created);
              setStep("test");
            }}
          />
        )}
        {step === "test" && issuer && rule && (
          <TestStep issuer={issuer} rule={rule} onDone={onDone} />
        )}
      </ModalContent>
    </Modal>
  );
}

function StepIndicator({
  steps,
  current
}: {
  steps: string[];
  current: number;
}) {
  return (
    <ol className="flex w-full items-center gap-2 pt-4">
      {steps.map((label, index) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
              index < current &&
                "border-primary bg-primary text-primary-foreground",
              index === current && "border-primary text-primary",
              index > current && "text-muted-foreground"
            )}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              "truncate text-sm",
              index === current ? "font-medium" : "text-muted-foreground"
            )}
          >
            {label}
          </span>
          {index < steps.length - 1 && (
            <span className="h-px flex-1 bg-border" />
          )}
        </li>
      ))}
    </ol>
  );
}

function Tile({
  title,
  hint,
  onClick
}: {
  title: ReactNode;
  hint: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function IssuerStep({
  issuers,
  onChosen,
  onClose
}: {
  issuers: IssuerOption[];
  onChosen: (issuer: IssuerOption) => void;
  onClose: () => void;
}) {
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "users");
  const [provider, setProvider] = useState<FederationProvider | null>(null);
  // What the issuer form posted, to name the issuer once the server answers.
  const submitted = useRef<FederationIssuerForm | null>(null);
  const fetcher = useAction<{ data: { id: string } | null }>({
    onSuccess: (result) => {
      const values = submitted.current;
      const id = "data" in result ? result.data?.id : undefined;
      if (!values || !id) return;
      onChosen({
        id,
        name: values.name,
        provider: values.provider,
        issuer: values.issuer
      });
    }
  });

  if (provider) {
    return (
      <ValidatedForm
        validator={federationIssuerValidator}
        method="post"
        action={`${path.to.newFederationIssuer}?wizard=1`}
        defaultValues={issuerValuesFor(provider)}
        fetcher={fetcher}
        onSubmit={(data) => {
          submitted.current = data;
        }}
      >
        <ModalBody>
          <IssuerFields
            key={provider}
            initialValues={issuerValuesFor(provider)}
            provider={provider}
            isDisabled={isDisabled}
          />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={() => setProvider(null)}>
              <Trans>Back</Trans>
            </Button>
            <Submit isDisabled={isDisabled}>
              <Trans>Register issuer</Trans>
            </Submit>
          </HStack>
        </ModalFooter>
      </ValidatedForm>
    );
  }

  return (
    <>
      <ModalBody>
        <VStack spacing={4}>
          {issuers.length > 0 && (
            <VStack spacing={2} className="w-full">
              <span className="text-sm font-medium">
                <Trans>Use an issuer you registered</Trans>
              </span>
              <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2">
                {issuers.map((row) => (
                  <Tile
                    key={row.id}
                    title={row.name}
                    hint={row.issuer}
                    onClick={() => onChosen(row)}
                  />
                ))}
              </div>
            </VStack>
          )}
          <VStack spacing={2} className="w-full">
            <span className="text-sm font-medium">
              <Trans>Register a new issuer</Trans>
            </span>
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-3">
              {federationProviders.map((value) => (
                <Tile
                  key={value}
                  title={
                    <HStack spacing={1}>
                      <LuPlus className="size-3" />
                      <span>{value}</span>
                    </HStack>
                  }
                  hint={FEDERATION_PRESETS[value].hint}
                  onClick={() => setProvider(value)}
                />
              ))}
            </div>
          </VStack>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="solid" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </ModalFooter>
    </>
  );
}

function RuleSteps({
  step,
  issuer,
  issuers,
  companyId,
  onStep,
  onCreated
}: {
  step: "rule" | "target";
  issuer: IssuerOption;
  issuers: IssuerOption[];
  companyId?: string;
  onStep: (step: Step) => void;
  onCreated: (rule: CreatedRule) => void;
}) {
  const initialValues = ruleValuesFor(issuer);
  const submitted = useRef<{ audience: string } | null>(null);
  const fetcher = useAction<{ data: { id: string } | null }>({
    onSuccess: (result) => {
      const id = "data" in result ? result.data?.id : undefined;
      if (id && submitted.current) {
        onCreated({ id, audience: submitted.current.audience });
      }
    }
  });

  return (
    <ValidatedForm
      validator={federationRuleValidator}
      method="post"
      action={`${path.to.newFederationRule}?wizard=1`}
      defaultValues={initialValues}
      fetcher={fetcher}
      onSubmit={(data) => {
        submitted.current = { audience: data.audience };
      }}
    >
      <RuleStepPanels
        step={step}
        issuer={issuer}
        issuers={issuers}
        companyId={companyId}
        initialValues={initialValues}
        onStep={onStep}
      />
    </ValidatedForm>
  );
}

/** Both panels stay mounted, so what the Rule step holds posts with the Target step. */
function RuleStepPanels({
  step,
  issuer,
  issuers,
  companyId,
  initialValues,
  onStep
}: {
  step: "rule" | "target";
  issuer: IssuerOption;
  issuers: IssuerOption[];
  companyId?: string;
  initialValues: ReturnType<typeof ruleValuesFor>;
  onStep: (step: Step) => void;
}) {
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "users");
  const { validateField, fieldErrors } = useFormContext();

  // A refusal of a Rule-step field on submit sends the reader back to it.
  const ruleStepError = RULE_STEP_FIELDS.some((field) => fieldErrors[field]);
  useEffect(() => {
    if (ruleStepError) onStep("rule");
  }, [ruleStepError, onStep]);

  const next = async () => {
    const errors = await Promise.all(RULE_STEP_FIELDS.map(validateField));
    if (errors.every((error) => !error)) onStep("target");
  };

  return (
    <>
      <ModalBody>
        <div className={step === "rule" ? undefined : "hidden"}>
          <RuleFields
            initialValues={initialValues}
            issuers={issuers}
            fixedIssuer={issuer}
            isDisabled={isDisabled}
          />
        </div>
        <div className={step === "target" ? undefined : "hidden"}>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                The keys this rule issues act as you, limited to these scopes.
              </Trans>
            </p>
            <RulePermissions companyId={companyId} isDisabled={isDisabled} />
          </VStack>
        </div>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button
            variant="solid"
            onClick={() => onStep(step === "rule" ? "issuer" : "rule")}
          >
            <Trans>Back</Trans>
          </Button>
          {step === "rule" ? (
            <Button onClick={next}>
              <Trans>Next</Trans>
            </Button>
          ) : (
            <Submit isDisabled={isDisabled}>
              <Trans>Create rule</Trans>
            </Submit>
          )}
        </HStack>
      </ModalFooter>
    </>
  );
}

function TestStep({
  issuer,
  rule,
  onDone
}: {
  issuer: IssuerOption;
  rule: CreatedRule;
  onDone: (ruleId: string) => void;
}) {
  const { ERP_URL } = getBrowserEnv();
  const exchanges = useFetcher<{ exchanges: ExchangeAttempt[] }>();
  const [waiting, setWaiting] = useState(true);
  const rows = exchanges.data?.exchanges ?? [];
  const succeeded = rows.some((row) => row.outcome === "Succeeded");
  const load = exchanges.load;
  const url = path.to.api.federationRuleExchanges(rule.id);

  useEffect(() => {
    if (!waiting || succeeded) return;
    load(url);
    const poll = setInterval(() => load(url), 3_000);
    const stop = setTimeout(
      () => setWaiting(false),
      FEDERATION_LIMITS.testWaitMinutes * 60_000
    );
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [load, url, waiting, succeeded]);

  return (
    <>
      <ModalBody>
        <VStack spacing={4}>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Run this in the workload. Carbon shows each exchange attempt here,
              with the reason when it is refused.
            </Trans>
          </p>
          <UsageExample
            target={{
              ruleId: rule.id,
              audience: rule.audience,
              provider: issuer.provider,
              issuer: issuer.issuer
            }}
            erpUrl={ERP_URL}
          />
          {succeeded ? (
            <Alert variant="success">
              <LuCircleCheck className="size-4" />
              <AlertTitle>
                <Trans>Connected</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>The workload exchanged its token for an API key.</Trans>
              </AlertDescription>
            </Alert>
          ) : waiting ? (
            <HStack spacing={2}>
              <Spinner className="size-4" />
              <span className="text-sm text-muted-foreground">
                <Trans>Waiting for the first exchange…</Trans>
              </span>
            </HStack>
          ) : (
            <HStack spacing={2}>
              <span className="text-sm text-muted-foreground">
                <Trans>No exchange yet.</Trans>
              </span>
              <Button variant="secondary" onClick={() => setWaiting(true)}>
                <Trans>Keep waiting</Trans>
              </Button>
            </HStack>
          )}
          {rows.length > 0 && <RecentExchanges exchanges={rows} />}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button onClick={() => onDone(rule.id)}>
          <Trans>Done</Trans>
        </Button>
      </ModalFooter>
    </>
  );
}
