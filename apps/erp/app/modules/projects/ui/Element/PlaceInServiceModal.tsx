// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Combobox, DatePicker, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import type {
  PlaceInServiceResult,
  loader as placeInServiceLoader
} from "~/routes/x+/project+/$projectId.place-in-service";
import { path } from "~/utils/path";
import { placeInServiceValidator } from "../../projects.models";

/**
 * Place in service: capitalizes a capital project's assets under
 * construction into an in-service class (post-asset-transfer
 * `capitalizeCip`). Opened from a final-asset element, only that element's
 * asset is selected; opened from the project header, every asset under
 * construction is. A refusal shows per asset; the assets that went into
 * service stay capitalized.
 */
export function PlaceInServiceModal({
  projectId,
  fixedAssetId,
  onClose
}: {
  projectId: string;
  /** Select only this asset (a final-asset element's page). */
  fixedAssetId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const loadFetcher = useFetcher<typeof placeInServiceLoader>();
  // Closes when every selected asset went into service; a refusal keeps the
  // modal open with its reason.
  const submitFetcher = useAction<PlaceInServiceResult>({
    onSettled: (result) => {
      const placed = result?.results ?? [];
      if (placed.length > 0 && placed.every((r) => !r.error)) onClose();
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open
  useEffect(() => {
    loadFetcher.load(path.to.projectPlaceInService(projectId));
  }, [projectId]);

  const data = loadFetcher.data;
  const assets = data?.assets ?? [];
  // Undefined until the user changes the selection.
  const [picked, setPicked] = useState<string[] | undefined>(undefined);
  const selected =
    picked ??
    (fixedAssetId ? [fixedAssetId] : assets.map((asset) => asset.id)).filter(
      (id) => assets.some((asset) => asset.id === id)
    );
  const [toClassId, setToClassId] = useState("");
  const targetClass = data?.assetClasses.find((c) => c.id === toClassId);

  const results =
    submitFetcher.state === "idle" ? submitFetcher.data?.results : undefined;
  const failures = (results ?? []).filter((result) => result.error);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setPicked([...next]);
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        {!data ? (
          <ModalBody>
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          </ModalBody>
        ) : (
          <ValidatedForm
            validator={placeInServiceValidator}
            method="post"
            action={path.to.projectPlaceInService(projectId)}
            fetcher={submitFetcher}
            defaultValues={{
              fixedAssetIds: selected,
              toClassId: "",
              inServiceDate: data.inServiceDate
            }}
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Place in Service</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>
                  Each asset moves into its in-service class and starts
                  depreciating from the in-service date.
                </Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                {failures.length > 0 && (
                  <Alert variant="destructive">
                    <LuTriangleAlert />
                    <AlertDescription>
                      <ul className="flex flex-col gap-1">
                        {failures.map((failure) => (
                          <li key={failure.fixedAssetId}>
                            {failure.label ? `${failure.label}: ` : ""}
                            {failure.error}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                {assets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Trans>This project has no asset under construction.</Trans>
                  </p>
                ) : (
                  <ul className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
                    {assets.map((asset) => (
                      <li
                        key={asset.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        <Checkbox
                          id={`place-${asset.id}`}
                          checked={selected.includes(asset.id)}
                          onCheckedChange={(checked) =>
                            toggle(asset.id, checked === true)
                          }
                        />
                        <label
                          htmlFor={`place-${asset.id}`}
                          className="flex min-w-0 flex-1 items-center gap-2"
                        >
                          <span className="font-mono">
                            {asset.fixedAssetId}
                          </span>
                          <span className="truncate">{asset.name}</span>
                          {asset.elementReadableId === null && (
                            <span className="text-xs text-muted-foreground">
                              <Trans>Project</Trans>
                            </span>
                          )}
                        </label>
                        <span className="tabular-nums">
                          {currencyFormatter.format(asset.cipTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {selected.map((id) => (
                  <input
                    key={id}
                    type="hidden"
                    name="fixedAssetIds"
                    value={id}
                  />
                ))}
                <Combobox
                  name="toClassId"
                  label={t`Asset Class`}
                  termId="asset-class"
                  options={data.assetClasses.map((c) => ({
                    label: c.name,
                    value: c.id
                  }))}
                  onChange={(value) => setToClassId(value?.value ?? "")}
                />
                <DatePicker name="inServiceDate" label={t`In-Service Date`} />
                <div className="w-full rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium">
                    <Trans>Journal Preview</Trans>
                  </p>
                  {assets
                    .filter((asset) => selected.includes(asset.id))
                    .map((asset) => (
                      <p key={asset.id} className="text-muted-foreground">
                        <Trans>Debit</Trans>{" "}
                        {targetClass?.name ?? t`the selected class`} ·{" "}
                        <Trans>Credit</Trans> {asset.className} ·{" "}
                        <span className="tabular-nums">
                          {currencyFormatter.format(asset.cipTotal)}
                        </span>
                      </p>
                    ))}
                </div>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                withBlocker={false}
                isDisabled={
                  selected.length === 0 ||
                  !permissions.can("create", "accounting") ||
                  !permissions.can("update", "projects")
                }
              >
                <Trans>Place in Service</Trans>
              </Submit>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
