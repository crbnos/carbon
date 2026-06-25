import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Label,
  LabelWithHelp,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  Hidden,
  Number as NumberInput,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { itemSamplingPlanValidator } from "~/modules/quality/quality.models";
import {
  type InspectionLevel,
  type InspectionSeverity,
  resolveSamplingPlan,
  type SamplingPlanType,
  type SamplingStandard,
  standardAqlValues
} from "~/modules/quality/samplingStandards";

type SamplingPlanFormProps = {
  action: string;
  itemId: string;
  standard: SamplingStandard;
  initial?: {
    type: SamplingPlanType;
    sampleSize?: number | null;
    percentage?: number | string | null;
    aql?: number | string | null;
    inspectionLevel?: InspectionLevel;
    severity?: InspectionSeverity;
  } | null;
};

function useSamplingPlanOptions() {
  const { t } = useLingui();
  const typeOptions: { value: SamplingPlanType; label: string }[] = [
    { value: "All", label: t`Inspect All` },
    { value: "First", label: t`Inspect First N` },
    { value: "Percentage", label: t`Percentage` },
    { value: "AQL", label: t`AQL (Z1.4 / ISO 2859-1)` }
  ];

  const inspectionLevelOptions: { value: InspectionLevel; label: string }[] = [
    { value: "S1", label: t`S-1 (coarsest special)` },
    { value: "S2", label: t`S-2` },
    { value: "S3", label: t`S-3` },
    { value: "S4", label: t`S-4 (finest special)` },
    { value: "I", label: t`I (reduced)` },
    { value: "II", label: t`II (normal default)` },
    { value: "III", label: t`III (tightened)` }
  ];

  const severityOptions: { value: InspectionSeverity; label: string }[] = [
    { value: "Normal", label: t`Normal` },
    { value: "Tightened", label: t`Tightened` },
    { value: "Reduced", label: t`Reduced` }
  ];

  return { typeOptions, inspectionLevelOptions, severityOptions };
}

// Canonical string form of an AQL value, so options match stored values.
// DB returns NUMERIC(5,3) as e.g. "1.500" — normalize everything to "1.5".
function normalizeAql(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (Number.isNaN(n)) return null;
  return String(n);
}

function toNumberOrUndefined(
  v: number | string | null | undefined
): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}

const aqlOptions = standardAqlValues.map((v) => ({
  value: String(v),
  label: v.toString()
}));

const SAMPLE_LOT_SIZES = [10, 50, 100, 500, 1000];

export default function SamplingPlanForm({
  action,
  itemId,
  standard,
  initial
}: SamplingPlanFormProps) {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const { typeOptions, inspectionLevelOptions, severityOptions } =
    useSamplingPlanOptions();

  const initialType = initial?.type ?? "All";
  const initialSampleSize = initial?.sampleSize ?? null;
  const initialPercentage = toNumberOrUndefined(initial?.percentage) ?? null;
  const initialAqlString = normalizeAql(initial?.aql);
  const initialAqlNumber = toNumberOrUndefined(initial?.aql) ?? 1.0;
  const initialLevel: InspectionLevel = initial?.inspectionLevel ?? "II";
  const initialSeverity: InspectionSeverity = initial?.severity ?? "Normal";

  const [type, setType] = useState<SamplingPlanType>(initialType);
  const [sampleSize, setSampleSize] = useState<number>(initialSampleSize ?? 1);
  const [percentage, setPercentage] = useState<number>(initialPercentage ?? 10);
  const [aql, setAql] = useState<number>(initialAqlNumber);
  const [inspectionLevel, setInspectionLevel] =
    useState<InspectionLevel>(initialLevel);
  const [severity, setSeverity] = useState<InspectionSeverity>(initialSeverity);

  // Re-seed local state when the loader returns a new plan (e.g. after save).
  useEffect(() => {
    setType(initialType);
    setSampleSize(initialSampleSize ?? 1);
    setPercentage(initialPercentage ?? 10);
    setAql(initialAqlNumber);
    setInspectionLevel(initialLevel);
    setSeverity(initialSeverity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialType,
    initialSampleSize,
    initialPercentage,
    initialAqlNumber,
    initialLevel,
    initialSeverity
  ]);

  const planForPreview = {
    type,
    sampleSize,
    percentage,
    aql,
    inspectionLevel,
    severity
  };

  // Remount key — forces ValidatedForm (and all its name-bound fields) to
  // re-initialize from defaultValues whenever the saved plan changes.
  const formKey = [
    initialType,
    initialSampleSize ?? "",
    initialPercentage ?? "",
    initialAqlString ?? "",
    initialLevel,
    initialSeverity
  ].join("|");

  return (
    <Card>
      <ValidatedForm
        key={formKey}
        method="post"
        action={action}
        validator={itemSamplingPlanValidator}
        defaultValues={{
          itemId,
          type: initialType,
          sampleSize: initialSampleSize ?? undefined,
          percentage: initialPercentage ?? undefined,
          aql: (initialAqlString ?? "1") as any,
          inspectionLevel: initialLevel,
          severity: initialSeverity
        }}
      >
        <Hidden name="itemId" />
        <CardHeader>
          <CardTitle>
            <Trans>Sampling Plan</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Defines how many tracked entities are inspected per lot, and how
              many failures are tolerated before the lot is rejected.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={4} className="w-full">
            <div className="flex flex-col gap-2 w-full">
              <Label>
                <LabelWithHelp termId="sampling-plan-type">
                  <Trans>Plan Type</Trans>
                </LabelWithHelp>
              </Label>
              <Select
                name="type"
                options={typeOptions}
                onChange={(v) => v && setType(v.value as SamplingPlanType)}
              />
            </div>

            {type === "First" && (
              <div className="flex flex-col gap-2 w-full">
                <Label>
                  <LabelWithHelp termId="sampling-plan-sample-size">
                    <Trans>Sample Size</Trans>
                  </LabelWithHelp>
                </Label>
                <NumberInput
                  name="sampleSize"
                  minValue={1}
                  onChange={(n) => typeof n === "number" && setSampleSize(n)}
                />
              </div>
            )}

            {type === "Percentage" && (
              <div className="flex flex-col gap-2 w-full">
                <Label>
                  <LabelWithHelp termId="sampling-plan-percentage">
                    <Trans>Percentage of Lot</Trans>
                  </LabelWithHelp>
                </Label>
                <NumberInput
                  name="percentage"
                  minValue={1}
                  maxValue={100}
                  onChange={(n) => typeof n === "number" && setPercentage(n)}
                />
              </div>
            )}

            {type === "AQL" && (
              <div className="grid grid-cols-3 gap-4 w-full">
                <div className="flex flex-col gap-2">
                  <Label>
                    <LabelWithHelp termId="sampling-plan-aql">
                      <Trans>AQL</Trans>
                    </LabelWithHelp>
                  </Label>
                  <Select
                    name="aql"
                    options={aqlOptions}
                    onChange={(v) => v && setAql(parseFloat(v.value))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <LabelWithHelp termId="sampling-plan-inspection-level">
                      <Trans>Inspection Level</Trans>
                    </LabelWithHelp>
                  </Label>
                  <Select
                    name="inspectionLevel"
                    options={inspectionLevelOptions}
                    onChange={(v) =>
                      v && setInspectionLevel(v.value as InspectionLevel)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <LabelWithHelp termId="sampling-plan-severity">
                      <Trans>Severity</Trans>
                    </LabelWithHelp>
                  </Label>
                  <Select
                    name="severity"
                    options={severityOptions}
                    onChange={(v) =>
                      v && setSeverity(v.value as InspectionSeverity)
                    }
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 w-full border rounded-md p-4">
              <HStack className="justify-between">
                <span className="text-sm font-medium">
                  <Trans>Preview</Trans>
                </span>
                <span className="text-xs text-muted-foreground">
                  {standard === "ANSI_Z1_4" ? "ANSI/ASQ Z1.4" : "ISO 2859-1"}
                </span>
              </HStack>
              <table className="text-sm w-full">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-1">
                      <Trans>Lot</Trans>
                    </th>
                    <th className="text-left font-medium py-1">
                      <Trans>Sample</Trans>
                    </th>
                    <th className="text-left font-medium py-1">Ac</th>
                    <th className="text-left font-medium py-1">Re</th>
                    <th className="text-left font-medium py-1">
                      <Trans>Letter</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_LOT_SIZES.map((n) => {
                    const res = resolveSamplingPlan(
                      planForPreview,
                      n,
                      standard
                    );
                    return (
                      <tr key={n}>
                        <td className="py-1">{n}</td>
                        <td className="py-1">{res.sampleSize}</td>
                        <td className="py-1">{res.acceptance}</td>
                        <td className="py-1">{res.rejection}</td>
                        <td className="py-1">{res.codeLetter ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!canUpdate}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
