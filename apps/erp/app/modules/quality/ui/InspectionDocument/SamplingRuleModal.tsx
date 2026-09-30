import {
  Button,
  HStack,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type {
  InspectionLevel,
  InspectionSeverity,
  SamplingPlanType,
  SamplingStandard
} from "~/modules/quality/samplingStandards";
import {
  resolveSamplingPlan,
  standardAqlValues
} from "~/modules/quality/samplingStandards";

// One sampling rule, as stored on inspectionDocument (the default) and on
// inspectionFeature (the per-feature override). All-null = no rule.
export type SamplingRule = {
  samplingPlanType: SamplingPlanType | null;
  samplingSampleSize: number | null;
  samplingPercentage: number | null;
  samplingAql: number | null;
  samplingInspectionLevel: InspectionLevel | null;
  samplingSeverity: InspectionSeverity | null;
};

export const EMPTY_SAMPLING_RULE: SamplingRule = {
  samplingPlanType: null,
  samplingSampleSize: null,
  samplingPercentage: null,
  samplingAql: null,
  samplingInspectionLevel: null,
  samplingSeverity: null
};

export function samplingRuleToPlan(rule: SamplingRule | null | undefined) {
  if (!rule?.samplingPlanType) return null;
  return {
    type: rule.samplingPlanType,
    sampleSize: rule.samplingSampleSize,
    percentage: rule.samplingPercentage,
    aql: rule.samplingAql,
    inspectionLevel: rule.samplingInspectionLevel,
    severity: rule.samplingSeverity
  };
}

const SAMPLE_LOT_SIZES = [10, 50, 100, 500, 1000];

type SamplingRuleModalProps = {
  // "document" edits the document's default rule (the fallback for features
  // without their own rule); "feature" edits one feature's override, with an
  // Inherit choice that clears it.
  context: "document" | "feature";
  featureLabel?: string;
  standard: SamplingStandard;
  initial: SamplingRule;
  // The document default, used to preview what Inherit resolves to.
  inheritedRule?: SamplingRule | null;
  onSave: (rule: SamplingRule) => void;
  onClose: () => void;
};

const INHERIT = "__inherit__";

const SamplingRuleModal = ({
  context,
  featureLabel,
  standard,
  initial,
  inheritedRule,
  onSave,
  onClose
}: SamplingRuleModalProps) => {
  const { t } = useLingui();

  const [type, setType] = useState<string>(
    initial.samplingPlanType ?? (context === "feature" ? INHERIT : "All")
  );
  const [sampleSize, setSampleSize] = useState<number>(
    initial.samplingSampleSize ?? 1
  );
  const [percentage, setPercentage] = useState<number>(
    initial.samplingPercentage ?? 10
  );
  const [aql, setAql] = useState<number>(initial.samplingAql ?? 1.0);
  const [inspectionLevel, setInspectionLevel] = useState<InspectionLevel>(
    initial.samplingInspectionLevel ?? "II"
  );
  const [severity, setSeverity] = useState<InspectionSeverity>(
    initial.samplingSeverity ?? "Normal"
  );

  const typeOptions: { value: string; label: string }[] = [
    ...(context === "feature"
      ? [{ value: INHERIT, label: t`Inherit document default` }]
      : []),
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

  const isInherit = type === INHERIT;

  // The plan the preview resolves: the selected rule, or (for Inherit) the
  // document default, or All when nothing is defined anywhere.
  const previewPlan = isInherit
    ? (samplingRuleToPlan(inheritedRule) ?? { type: "All" as const })
    : {
        type: type as SamplingPlanType,
        sampleSize,
        percentage,
        aql,
        inspectionLevel,
        severity
      };

  const handleSave = () => {
    if (isInherit) {
      onSave(EMPTY_SAMPLING_RULE);
      onClose();
      return;
    }
    const planType = type as SamplingPlanType;
    onSave({
      samplingPlanType: planType,
      samplingSampleSize: planType === "First" ? sampleSize : null,
      samplingPercentage: planType === "Percentage" ? percentage : null,
      samplingAql: planType === "AQL" ? aql : null,
      samplingInspectionLevel: planType === "AQL" ? inspectionLevel : null,
      samplingSeverity: planType === "AQL" ? severity : null
    });
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {context === "document" ? (
              <Trans>Default Sampling</Trans>
            ) : (
              <Trans>Sampling — Feature {featureLabel}</Trans>
            )}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} className="w-full">
            {context === "document" ? (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Applies to features without their own rule, and to the lot
                  when this plan drives an inspection.
                </Trans>
              </p>
            ) : null}
            <div className="flex flex-col gap-2 w-full">
              <Label>
                <Trans>Plan Type</Trans>
              </Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "First" && (
              <div className="flex flex-col gap-2 w-full">
                <Label>
                  <Trans>Sample Size</Trans>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={String(sampleSize)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setSampleSize(Math.max(1, n));
                  }}
                />
              </div>
            )}

            {type === "Percentage" && (
              <div className="flex flex-col gap-2 w-full">
                <Label>
                  <Trans>Percentage of Lot</Trans>
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={String(percentage)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setPercentage(Math.min(100, Math.max(1, n)));
                    }
                  }}
                />
              </div>
            )}

            {type === "AQL" && (
              <div className="grid grid-cols-3 gap-4 w-full">
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>AQL</Trans>
                  </Label>
                  <Select
                    value={String(aql)}
                    onValueChange={(v) => setAql(parseFloat(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {standardAqlValues.map((v) => (
                        <SelectItem key={v} value={String(v)}>
                          {v.toString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Inspection Level</Trans>
                  </Label>
                  <Select
                    value={inspectionLevel}
                    onValueChange={(v) =>
                      setInspectionLevel(v as InspectionLevel)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {inspectionLevelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>
                    <Trans>Severity</Trans>
                  </Label>
                  <Select
                    value={severity}
                    onValueChange={(v) => setSeverity(v as InspectionSeverity)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {severityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    const res = resolveSamplingPlan(previewPlan, n, standard);
                    return (
                      <tr key={n}>
                        <td className="py-1 tabular-nums">{n}</td>
                        <td className="py-1 tabular-nums">{res.sampleSize}</td>
                        <td className="py-1 tabular-nums">{res.acceptance}</td>
                        <td className="py-1 tabular-nums">{res.rejection}</td>
                        <td className="py-1">{res.codeLetter ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={handleSave}>
            <Trans>Save</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SamplingRuleModal;
