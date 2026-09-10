import { useControlField } from "@carbon/form";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCircleAlert, LuInfo, LuTriangleAlert } from "react-icons/lu";
import { areaLabel, tableArea } from "../../backups.areas";
import type { CompanyBackupSummary } from "../../backups.service";
import { CONFIRM_WORD, disclosureState } from "./disclosure-state";
import { formatBackupDate, formatBackupName } from "./format";

type Finding = NonNullable<
  CompanyBackupSummary["compatibility"]
>["findings"][number];

/**
 * What the person is told before their company's data is replaced.
 *
 * The verdict rendered here was computed in the loader against the LIVE schema
 * (`getCompanyBackups`), so it describes what a restore would do right now. It
 * is DISCLOSURE, not authorization: the restore job runs the real gate itself
 * (`assertBackupImportable`), so this screen can never let through a restore
 * the gate would refuse.
 */
export function RestoreDisclosure({
  backups,
  onConfirm
}: {
  backups: CompanyBackupSummary[];
  onConfirm: (values: { source: string; includeStorage: string }) => void;
}) {
  const { t } = useLingui();
  const [source] = useControlField<string>("source");
  const [includeStorage] = useControlField<string>("includeStorage");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const backup = useMemo(
    () => backups.find((b) => `backup:${b.name}` === source),
    [backups, source]
  );

  // No verdict — an upload-sourced restore. The consequences below still
  // apply and are shown; only the findings are unknown, which the screen says
  // rather than implying a clean bill of health.
  const findings = backup?.compatibility?.findings ?? [];
  const { unchecked, blocked, discards, canConfirm } = disclosureState(
    backup,
    typed
  );

  const close = () => {
    setOpen(false);
    setTyped("");
  };

  return (
    <>
      <Button type="button" isDisabled={!source} onClick={() => setOpen(true)}>
        <Trans>Restore…</Trans>
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Restore this company from a backup</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {backup ? (
                <p className="text-sm text-muted-foreground">
                  {backup.label || formatBackupName(backup.name)}
                  {backup.exportedAt
                    ? ` · ${formatBackupDate(backup.exportedAt)}`
                    : ""}
                </p>
              ) : null}

              {/* Two sentences, always shown: what happens, and the way back.
                  Keep/Revert are explained on the review row afterwards, where
                  they are the actual decision. */}
              <p className="text-sm">
                <Trans>
                  This company's data is replaced with the contents of this
                  backup. Today's data is saved first, so you can revert.
                </Trans>
              </p>

              {unchecked ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This backup hasn't been checked yet. Any differences are
                    found when the restore runs.
                  </Trans>
                </p>
              ) : null}

              {findings.length > 0 ? (
                <FindingGroups findings={findings} />
              ) : null}

              {discards ? (
                <VStack spacing={1}>
                  <label className="text-sm" htmlFor="restore-confirm">
                    {/* Covers both losses above: values the schema will drop,
                        and rows the backup never contained. */}
                    <Trans>
                      Some records won't come back. Type{" "}
                      <span className="font-medium">{CONFIRM_WORD}</span> to
                      continue.
                    </Trans>
                  </label>
                  <Input
                    id="restore-confirm"
                    value={typed}
                    autoComplete="off"
                    placeholder={CONFIRM_WORD}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </VStack>
              ) : null}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
            {/* A blocked backup gets no confirm button at all. An explanation
                plus a disabled action reads as "try harder"; the only honest
                next step is to pick a different backup. */}
            {blocked ? null : (
              <Button
                isDisabled={!canConfirm}
                onClick={() => {
                  onConfirm({
                    source: source ?? "",
                    includeStorage: includeStorage ?? "all"
                  });
                  close();
                }}
              >
                {t`Restore`}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

const KIND_ORDER: Finding["kind"][] = ["blocked", "discarded", "defaulted"];

const KIND_ICON = {
  blocked: LuCircleAlert,
  discarded: LuTriangleAlert,
  defaulted: LuInfo
} as const;

/** Findings by kind, then by product area. Table names live in the expander. */
function FindingGroups({ findings }: { findings: Finding[] }) {
  const { t } = useLingui();
  const kindLabel: Record<Finding["kind"], string> = {
    blocked: t`Can't be restored`,
    discarded: t`Discarded`,
    defaulted: t`Filled with a default`
  };

  return (
    <VStack spacing={3}>
      {KIND_ORDER.filter((kind) => findings.some((f) => f.kind === kind)).map(
        (kind) => {
          const forKind = findings.filter((f) => f.kind === kind);
          const Icon = KIND_ICON[kind];
          const areas = [...new Set(forKind.map((f) => tableArea(f.table)))];
          const areaNames = areas.map((a) => t(areaLabel(a))).join(", ");
          return (
            <VStack key={kind} spacing={1}>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-4 w-4 shrink-0" />
                {kindLabel[kind]}
              </span>
              {/* The area, not the table — "Production" means something to the
                  person deciding; `jobOperationDependency` does not. */}
              <span className="text-sm text-muted-foreground">{areaNames}</span>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  <Trans>Details</Trans>
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {forKind.map((f) => (
                    <li key={`${f.table}.${f.column ?? ""}`}>
                      <span className="font-mono">
                        {f.table}
                        {f.column ? `.${f.column}` : ""}
                      </span>
                      {" — "}
                      {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            </VStack>
          );
        }
      )}
    </VStack>
  );
}
