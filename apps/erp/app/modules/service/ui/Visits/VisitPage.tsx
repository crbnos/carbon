// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { storage } from "@carbon/files";
import { useAction, useRevalidator } from "@carbon/query";
import type { SignaturePadHandle } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  SignaturePad,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";
import {
  LuChevronLeft,
  LuMapPin,
  LuPackageMinus,
  LuReceipt,
  LuSignature
} from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, FileDropzone } from "~/components";
import { useUser } from "~/hooks";
import { IssueMaterialModal } from "~/modules/projects/ui/Element/IssueMaterialModal";
import { getPrivateUrl, path } from "~/utils/path";
import type { ServiceOrderStatus as ServiceOrderStatusType } from "../../service.models";
import { formatSiteAddress, mapUrl } from "../../service.models";
import type { ServiceVisitDetail, ServiceWorkNode } from "../../types";
import { ServiceRichText } from "../ServiceRichText";
import {
  ServiceOrderStatus,
  ServiceVisitStatus,
  WarrantyBadge
} from "../ServiceStatus";
import AddExpenseModal from "../Work/AddExpenseModal";
import NodePicker from "./NodePicker";
import { VisitStatusActions } from "./VisitStatusActions";
import WorkTimer from "./WorkTimer";

export type VisitPageProps = {
  visit: ServiceVisitDetail;
  nodes: ServiceWorkNode[];
  lastServiceDates: Record<string, string | null>;
  recentOrders: {
    id: string;
    serviceOrderId: string;
    status: ServiceOrderStatusType;
    createdAt: string;
  }[];
  photos: { name: string; path: string }[];
  laborCategories: { id: string; name: string }[];
  defaultLaborCategoryId: string | null;
  /** May work this visit: its technician, or a user who updates service. */
  mayWork: boolean;
  /** May move this visit's status. */
  mayMove: boolean;
  canIssue: boolean;
};

/**
 * The technician's page for one visit, phone-first and in the order of the
 * work: travel and arrive, the unit and its history, the work tree with the
 * clock, parts and expenses, notes, photos, the customer's signature, and
 * Complete with **Work complete?**.
 */
export default function VisitPage({
  visit,
  nodes,
  lastServiceDates,
  recentOrders,
  photos,
  laborCategories,
  defaultLaborCategoryId,
  mayWork,
  mayMove,
  canIssue
}: VisitPageProps) {
  const { t } = useLingui();
  const order = visit.serviceOrder;
  const address = formatSiteAddress(order.customerLocation?.address);
  const chargeAction = path.to.serviceOrderCharge(order.id);

  const [selectedId, setSelectedId] = useState<string | null>(
    nodes.length === 1 ? (nodes[0]?.id ?? null) : null
  );
  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedNode = selected
    ? {
        id: selected.id,
        readableId: selected.readableId,
        name: selected.name,
        itemId: selected.itemId
      }
    : null;
  const [modal, setModal] = useState<"part" | "expense" | null>(null);

  const visitOpen =
    visit.status !== "Completed" && visit.status !== "Cancelled";
  const orderOpen = order.status !== "Closed" && order.status !== "Cancelled";
  const canWork = mayWork && visitOpen && orderOpen;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-16">
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="lg"
            leftIcon={<LuChevronLeft />}
            className="self-start -ml-3"
            asChild
          >
            <Link to={path.to.myVisits}>
              <Trans>My Visits</Trans>
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={path.to.serviceOrder(order.id)}
              className="whitespace-nowrap text-xl font-semibold hover:underline"
            >
              {order.serviceOrderId}
            </Link>
            <ServiceVisitStatus status={visit.status} />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="font-medium">{order.customer?.name}</span>
              {(order.customerLocation?.name || address) && (
                <span className="text-muted-foreground">
                  {[order.customerLocation?.name, address]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              <span className="text-muted-foreground tabular-nums">
                <DateTime
                  value={visit.plannedStart}
                  variant="absolute"
                  fallback={<Trans>Not planned</Trans>}
                />
                {visit.plannedEnd && (
                  <>
                    {" – "}
                    <DateTime value={visit.plannedEnd} variant="time" />
                  </>
                )}
              </span>
            </div>
            {address && (
              <Button
                variant="secondary"
                size="lg"
                isIcon
                className="shrink-0"
                asChild
              >
                <a
                  href={mapUrl(address)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t`Open in maps`}
                >
                  <LuMapPin className="size-5" />
                </a>
              </Button>
            )}
          </div>
          {(visit.status === "Scheduled" || visit.status === "Traveling") && (
            <VisitStatusActions
              serviceOrderId={order.id}
              visitId={visit.id}
              status={visit.status}
              isDisabled={!mayMove || !orderOpen}
              size="lg"
            />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Unit</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {[order.item?.readableIdWithRevision, order.item?.name]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {order.trackedEntity?.readableId}
                </span>
              </div>
              {order.customerAsset && (
                <WarrantyBadge asset={order.customerAsset} />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Last orders</Trans>
              </span>
              {recentOrders.length === 0 ? (
                <span className="text-muted-foreground">
                  <Trans>No earlier service orders.</Trans>
                </span>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recentOrders.map((recent) => (
                    <li key={recent.id}>
                      <Link
                        to={path.to.serviceOrder(recent.id)}
                        className="flex min-h-11 items-center justify-between gap-2 hover:underline"
                      >
                        <span className="whitespace-nowrap font-medium">
                          {recent.serviceOrderId}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <DateTime value={recent.createdAt} variant="date" />
                          <ServiceOrderStatus status={recent.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Work</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NodePicker
              nodes={nodes}
              lastServiceDates={lastServiceDates}
              selectedId={selectedId}
              onSelect={(node) => setSelectedId(node.id)}
            />
            {!selected && nodes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Choose an element to log time, issue a part or add an expense.
                </Trans>
              </p>
            )}
            <WorkTimer
              visitId={visit.id}
              projectId={order.projectId}
              node={selectedNode}
              chargeAction={chargeAction}
              laborCategories={laborCategories}
              defaultLaborCategoryId={defaultLaborCategoryId}
              isDisabled={!canWork}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuPackageMinus />}
                isDisabled={!canWork || !canIssue || !selected}
                onClick={() => setModal("part")}
              >
                <Trans>Issue Part</Trans>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuReceipt />}
                isDisabled={!canWork || !selected}
                onClick={() => setModal("expense")}
              >
                <Trans>Add Expense</Trans>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Notes</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ServiceRichText
              key={visit.id}
              action={path.to.serviceVisit(order.id, visit.id)}
              field="notes"
              value={visit.notes}
              isDisabled={!canWork}
              empty={<Trans>No notes.</Trans>}
            />
          </CardContent>
        </Card>

        <VisitPhotos
          serviceOrderId={order.id}
          visitId={visit.id}
          photos={photos}
          isDisabled={!canWork}
        />

        <VisitSignature
          serviceOrderId={order.id}
          visitId={visit.id}
          signaturePath={visit.signaturePath}
          signedByName={visit.signedByName}
          isDisabled={!canWork}
        />

        {visit.status === "On Site" && (
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Finish</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VisitStatusActions
                serviceOrderId={order.id}
                visitId={visit.id}
                status={visit.status}
                isDisabled={!mayMove || !orderOpen}
                size="lg"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {modal === "part" && selectedNode && (
        <IssueMaterialModal
          projectId={order.projectId}
          element={selectedNode}
          action={chargeAction}
          hiddenFields={{ intent: "part", serviceVisitId: visit.id }}
          variant="service"
          onClose={() => setModal(null)}
        />
      )}
      {modal === "expense" && selectedNode && (
        <AddExpenseModal
          action={chargeAction}
          node={selectedNode}
          serviceVisitId={visit.id}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

/**
 * Photos of the visit, in the company's private bucket under
 * `${companyId}/service/${orderId}/${visitId}/`. HEIC is converted to JPEG
 * by the dropzone before upload.
 */
function VisitPhotos({
  serviceOrderId,
  visitId,
  photos,
  isDisabled
}: {
  serviceOrderId: string;
  visitId: string;
  photos: { name: string; path: string }[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const [isUploading, setIsUploading] = useState(false);
  const { company } = useUser();

  const upload = async (files: File[]) => {
    if (!carbon || files.length === 0) return;
    setIsUploading(true);
    try {
      const bucket = storage(carbon).company(company.id);
      const results = await Promise.all(
        files.map((file) => {
          const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
          return bucket.upload(
            `${company.id}/service/${serviceOrderId}/${visitId}/${nanoid()}.${extension}`,
            file,
            { contentType: file.type || undefined }
          );
        })
      );
      if (results.some((result) => result.error)) {
        toast.error(t`Failed to upload a photo`);
      }
      revalidator.revalidate();
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Photos</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <li key={photo.path}>
                <a
                  href={getPrivateUrl(photo.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-square overflow-hidden rounded-lg border border-border"
                >
                  <img
                    src={getPrivateUrl(photo.path)}
                    alt={photo.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
        {!isDisabled && (
          <FileDropzone
            onDrop={upload}
            accept={{ "image/*": [] }}
            disabled={isUploading}
            className=""
          />
        )}
        {isDisabled && photos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Trans>No photos.</Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The customer's signature: a pad and the signer's name, saved as a PNG
 * through the signature route. A saved signature shows with its name, and
 * can be signed again while the visit is open.
 */
function VisitSignature({
  serviceOrderId,
  visitId,
  signaturePath,
  signedByName,
  isDisabled
}: {
  serviceOrderId: string;
  visitId: string;
  signaturePath: string | null;
  signedByName: string | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => {
      setIsSigning(false);
      setHasInk(false);
    },
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the signature`)
  });
  const isSaving = fetcher.state !== "idle";

  const save = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || !name.trim()) return;
    let blob: Blob;
    try {
      blob = await pad.toBlob();
    } catch {
      toast.error(t`Failed to read the signature`);
      return;
    }
    const formData = new FormData();
    formData.append(
      "signature",
      new File([blob], "signature.png", { type: "image/png" })
    );
    formData.append("signedByName", name.trim());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.serviceVisitSignature(serviceOrderId, visitId),
      encType: "multipart/form-data"
    });
  };

  const showSaved = signaturePath && !isSigning;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Signature</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {showSaved ? (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <img
                src={getPrivateUrl(signaturePath)}
                alt={t`Signature`}
                className="h-40 w-full object-contain"
              />
            </div>
            <span className="text-sm">
              <Trans>Signed by {signedByName}</Trans>
            </span>
            {!isDisabled && (
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuSignature />}
                className="self-start"
                onClick={() => setIsSigning(true)}
              >
                <Trans>Sign Again</Trans>
              </Button>
            )}
          </>
        ) : isDisabled ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Not signed.</Trans>
          </p>
        ) : (
          <>
            <SignaturePad
              ref={padRef}
              strokeColor="#000000"
              className="[&>div:first-child]:bg-white"
              onChange={(isEmpty) => setHasInk(!isEmpty)}
              disabled={isSaving}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">
                <Trans>Signed by</Trans>
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="h-11"
              />
            </label>
            <Button
              size="lg"
              variant="primary"
              leftIcon={<LuSignature />}
              isDisabled={!hasInk || !name.trim()}
              isLoading={isSaving}
              onClick={save}
            >
              <Trans>Save Signature</Trans>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
