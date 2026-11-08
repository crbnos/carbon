// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  Hidden,
  Select,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Label,
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
import { suggestCoverage } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuCheck, LuQrCode } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import {
  serviceCoverages,
  serviceJobNewValidator,
  serviceWorkSites
} from "~/services/models";
import { path } from "~/utils/path";
import {
  CoverageBadge,
  useCoverageLabels,
  useWorkSiteLabels,
  WarrantyBadge
} from "./ServiceJobStatus";

type ScannedAsset = {
  id: string;
  customerId: string;
  laborWarrantyEndDate: string | null;
  partsWarrantyEndDate: string | null;
  customer: { id: string; name: string } | null;
  item: { id: string; name: string; readableIdWithRevision: string } | null;
  trackedEntity: { id: string; readableId: string | null } | null;
};

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "none"; serial: string }
  | { state: "found"; assets: ScannedAsset[] };

/**
 * MES → Service → New Job. The technician scans the unit's serial: a customer
 * asset brings its customer, item and warranty, and suggests the coverage.
 * Without one, they pick the customer. The job opens In Progress with their
 * clock running (`service.new.tsx`).
 */
export function NewServiceJobModal({
  today,
  onClose
}: {
  /** The company's day, `YYYY-MM-DD`: the warranty is read on it. */
  today: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const fetcher = useFetcher<{ id?: string }>();
  const coverageLabels = useCoverageLabels();
  const workSiteLabels = useWorkSiteLabels();

  const [serial, setSerial] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<
    { value: string; label: string }[]
  >([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  // Enter, then the blur that follows, must not look the same serial up twice.
  const lastScanned = useRef("");

  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    carbon
      .from("customer")
      .select("id, name")
      .eq("companyId", company.id)
      .order("name")
      .then(({ data }) => {
        if (cancelled) return;
        setCustomers(
          (data ?? []).map((customer) => ({
            value: customer.id,
            label: customer.name
          }))
        );
        setCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, company.id]);

  // The scan tab of MaintenanceAddPartModal, then the asset that holds the
  // unit. A serial is the tracked entity's readable id; its raw id also works.
  const findAsset = async (value: string) => {
    const scanned = value.trim();
    if (scanned === lastScanned.current) return;
    lastScanned.current = scanned;
    setAssetId(null);
    if (!scanned || !carbon) {
      setLookup({ state: "idle" });
      return;
    }
    setLookup({ state: "loading" });
    const [byReadableId, byId] = await Promise.all([
      carbon
        .from("trackedEntity")
        .select("id")
        .eq("companyId", company.id)
        .eq("readableId", scanned),
      carbon
        .from("trackedEntity")
        .select("id")
        .eq("companyId", company.id)
        .eq("id", scanned)
    ]);
    const trackedEntityIds = [
      ...new Set(
        [...(byReadableId.data ?? []), ...(byId.data ?? [])].map(
          (entity) => entity.id
        )
      )
    ];
    if (trackedEntityIds.length === 0) {
      setLookup({ state: "none", serial: scanned });
      return;
    }
    const assets = await carbon
      .from("customerAsset")
      .select(
        "id, customerId, laborWarrantyEndDate, partsWarrantyEndDate, customer:customer!customerAsset_customerId_fkey(id, name), item:item!customerAsset_itemId_fkey(id, name, readableIdWithRevision), trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey(id, readableId)"
      )
      .eq("companyId", company.id)
      .in("trackedEntityId", trackedEntityIds);
    const found = (assets.data ?? []) as ScannedAsset[];
    if (found.length === 0) {
      setLookup({ state: "none", serial: scanned });
      return;
    }
    setLookup({ state: "found", assets: found });
    if (found.length === 1) setAssetId(found[0].id);
  };

  const assets = lookup.state === "found" ? lookup.assets : [];
  const asset = assets.find((a) => a.id === assetId) ?? null;
  const suggested = asset ? suggestCoverage(asset, today) : "Billable";
  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        {/* Keyed by the asset, so its customer and suggested coverage become
            the form's defaults when a scan finds it. */}
        <ValidatedForm
          key={asset?.id ?? "no-asset"}
          method="post"
          action={path.to.newServiceJob}
          validator={serviceJobNewValidator}
          fetcher={fetcher}
          defaultValues={{
            customerAssetId: asset?.id ?? "",
            customerId: asset?.customerId ?? "",
            problem: "",
            workSite: "Customer Site",
            coverage: suggested
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>New Service Job</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>The job opens with your clock running.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="flex w-full flex-col gap-1">
                <Label htmlFor="serviceJobSerial">
                  <Trans>Serial</Trans>
                </Label>
                <InputGroup>
                  <Input
                    id="serviceJobSerial"
                    size="lg"
                    autoFocus
                    placeholder={t`Scan or enter a serial`}
                    value={serial}
                    onChange={(event) => setSerial(event.target.value)}
                    onKeyDown={(event) => {
                      // A scanner ends with Enter: look the serial up, do
                      // not submit the form.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        findAsset(serial);
                      }
                    }}
                    onBlur={() => findAsset(serial)}
                  />
                  <InputRightElement className="pl-2">
                    {lookup.state === "loading" ? (
                      <Spinner />
                    ) : asset ? (
                      <LuCheck className="text-emerald-500" />
                    ) : (
                      <LuQrCode />
                    )}
                  </InputRightElement>
                </InputGroup>
                {lookup.state === "none" && (
                  <span className="text-xs text-muted-foreground">
                    <Trans>
                      No customer asset has the serial {lookup.serial}. Choose
                      the customer.
                    </Trans>
                  </span>
                )}
              </div>

              {assets.length > 1 && (
                <div className="flex w-full flex-col gap-2">
                  <span className="text-xs text-muted-foreground">
                    <Trans>
                      More than one unit has this serial. Choose one.
                    </Trans>
                  </span>
                  {assets.map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      size="lg"
                      variant={option.id === assetId ? "primary" : "secondary"}
                      className="justify-start"
                      onClick={() => setAssetId(option.id)}
                    >
                      <span className="truncate">
                        {option.item?.name} · {option.customer?.name}
                      </span>
                    </Button>
                  ))}
                </div>
              )}

              {asset && (
                <div className="flex w-full flex-col gap-2 rounded-lg border border-border p-3">
                  <span className="text-base font-semibold truncate">
                    {asset.customer?.name}
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    {[asset.item?.name, asset.trackedEntity?.readableId]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <HStack spacing={2} className="flex-wrap">
                    <WarrantyBadge asset={asset} today={today} />
                    <span className="text-xs text-muted-foreground">
                      <Trans>Suggested coverage</Trans>
                    </span>
                    <CoverageBadge coverage={suggested} />
                  </HStack>
                </div>
              )}

              <Hidden name="customerAssetId" value={asset?.id ?? ""} />
              {asset ? (
                <Hidden name="customerId" value={asset.customerId} />
              ) : (
                <Combobox
                  name="customerId"
                  label={t`Customer`}
                  size="lg"
                  isLoading={customersLoading}
                  options={customers}
                  placeholder={t`Select a customer`}
                />
              )}
              <TextArea name="problem" label={t`Problem`} size="lg" />
              <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                <Select
                  name="workSite"
                  label={t`Work Site`}
                  size="lg"
                  options={serviceWorkSites.map((workSite) => ({
                    value: workSite,
                    label: workSiteLabels[workSite]
                  }))}
                />
                <Select
                  name="coverage"
                  label={t`Coverage`}
                  size="lg"
                  options={serviceCoverages.map((coverage) => ({
                    value: coverage,
                    label: coverageLabels[coverage]
                  }))}
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button size="lg" variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              size="lg"
              isDisabled={isSubmitting || lookup.state === "loading"}
              isLoading={isSubmitting}
            >
              <Trans>Start Job</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
