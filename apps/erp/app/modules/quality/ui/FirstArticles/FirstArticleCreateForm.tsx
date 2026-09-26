import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Combobox, Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  firstArticleInspectionCreateValidator,
  firstArticleInspectionReasons,
  firstArticleInspectionScopes
} from "../../quality.models";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

type Option = { id: string; readableId: string; label: string };

type FirstArticleCreateFormProps = {
  initialValues: z.infer<typeof firstArticleInspectionCreateValidator>;
  jobs: { id: string; label: string }[];
  makeMethods: Option[];
  baselines: Option[];
};

/**
 * Manual "New First Article": the same generator the release runs, for one
 * chosen make method — for the AS9102 triggers data can't detect (process,
 * source, tooling, NC program, location change, corrective action).
 */
const FirstArticleCreateForm = ({
  initialValues,
  jobs,
  makeMethods,
  baselines
}: FirstArticleCreateFormProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const labels = useFirstArticleLabels();

  const [makeMethodId, setMakeMethodId] = useState(
    initialValues.jobMakeMethodId
  );
  const [scope, setScope] = useState(initialValues.scope);

  const readableId = makeMethods.find((m) => m.id === makeMethodId)?.readableId;
  const baselineOptions = baselines
    .filter((baseline) => !readableId || baseline.readableId === readableId)
    .map((baseline) => ({ value: baseline.id, label: baseline.label }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={firstArticleInspectionCreateValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            <Trans>New First Article</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Creates an AS9102 first article inspection for one part of a job,
              inspected against the part's first article plan.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="jobId" />
          <VStack spacing={4}>
            <Combobox
              name="jobSelect"
              label={t`Job`}
              value={initialValues.jobId}
              options={jobs.map((job) => ({
                value: job.id,
                label: job.label
              }))}
              onChange={(selected) => {
                if (selected?.value && selected.value !== initialValues.jobId) {
                  navigate(
                    `${path.to.newFirstArticle}?jobId=${encodeURIComponent(selected.value)}`
                  );
                }
              }}
            />
            <Select
              name="jobMakeMethodId"
              label={t`Part`}
              options={makeMethods.map((method) => ({
                value: method.id,
                label: method.label
              }))}
              onChange={(selected) => setMakeMethodId(selected?.value ?? "")}
            />
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Select
                name="scope"
                label={t`Scope`}
                options={firstArticleInspectionScopes.map((value) => ({
                  value,
                  label: labels.scope(value)
                }))}
                onChange={(selected) =>
                  setScope(
                    (selected?.value as typeof scope | undefined) ?? "Full"
                  )
                }
              />
              <Select
                name="reason"
                label={t`Reason`}
                options={firstArticleInspectionReasons.map((value) => ({
                  value,
                  label: labels.reason(value)
                }))}
              />
            </div>
            {scope === "Partial" && (
              <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                <Select
                  name="baselineFirstArticleInspectionId"
                  label={t`Baseline First Article`}
                  options={baselineOptions}
                  isOptional
                />
                <Input
                  name="baselineReference"
                  label={t`External Baseline`}
                  helperText={t`A FAIR number from outside Carbon`}
                />
              </div>
            )}
          </VStack>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit
              isDisabled={
                !permissions.can("create", "quality") || !initialValues.jobId
              }
            >
              <Trans>Create</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default FirstArticleCreateForm;
