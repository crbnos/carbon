import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuShoppingCart, LuTriangleAlert } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import Select from "~/components/Select";
import SupplierAvatar from "~/components/SupplierAvatar";
import { path } from "~/utils/path";
import type { JobReleaseReadiness } from "../../production.service";

// Releasing a batch releases its Draft/Planned member jobs, so this is the job
// Release dialog for all of them at once: the same checks (every assembly has an
// operation, manufacturing not blocked — any failure blocks the whole batch) and
// the same purchase-order choice, made once per supplier across every job.
export function BatchReleaseModal({
  target,
  title,
  confirmLabel,
  isSubmitting,
  onConfirm,
  onClose
}: {
  target: { batchId: string } | { jobIds: string[] };
  title: string;
  confirmLabel: string;
  isSubmitting?: boolean;
  onConfirm: (purchaseOrdersBySupplierId?: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const readinessFetcher = useFetcher<
    JobReleaseReadiness | { error: string }
  >();
  const [purchaseOrders, setPurchaseOrders] = useState<Record<string, string>>(
    {}
  );

  const url = path.to.api.batchReleaseReadiness(target);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per target
  useEffect(() => {
    readinessFetcher.load(url);
  }, [url]);

  const result = readinessFetcher.data;
  const readiness = result && "jobs" in result ? result : null;
  const loadError = result && "error" in result ? result.error : null;

  useEffect(() => {
    if (!readiness) return;
    setPurchaseOrders(
      Object.fromEntries(readiness.suppliers.map((s) => [s.supplierId, "new"]))
    );
  }, [readiness]);

  const blocked = (readiness?.jobs ?? []).filter(
    (job) =>
      job.manufacturingBlocked ||
      job.missingAssemblies.length > 0 ||
      job.outsideOperationsWithoutSupplier.length > 0
  );
  const jobIds = (readiness?.jobs ?? []).map((job) => job.jobId);
  const canRelease = !!readiness && blocked.length === 0 && !isSubmitting;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size={readiness?.suppliers.length ? "large" : "medium"}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {loadError ? (
            <Alert variant="destructive">
              <LuTriangleAlert />
              <AlertTitle>{loadError}</AlertTitle>
            </Alert>
          ) : !readiness ? (
            <div className="flex h-[118px] w-full flex-col items-center justify-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm">
                <Trans>Checking the batch's jobs...</Trans>
              </p>
            </div>
          ) : (
            <VStack spacing={4}>
              {blocked.length > 0 ? (
                <Alert variant="warning">
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>Fix these jobs before releasing</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Releasing the batch releases its jobs, and each one must
                      be ready for the floor.
                    </Trans>
                    <ul className="mt-2 list-disc pl-4 space-y-1">
                      {blocked.map((job) => (
                        <li key={job.id}>
                          <Link
                            to={path.to.job(job.id)}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {job.jobId}
                          </Link>
                          {" — "}
                          {[
                            job.manufacturingBlocked &&
                              t`manufacturing is blocked`,
                            job.missingAssemblies.length > 0 &&
                              t`no operations on ${job.missingAssemblies
                                .map((m) => m.description)
                                .join(", ")}`,
                            ...job.outsideOperationsWithoutSupplier.map((op) =>
                              op.missing === "choose"
                                ? t`choose a supplier for ${op.description} on the job`
                                : t`${op.description} has no supplier`
                            )
                          ]
                            .filter(Boolean)
                            .join("; ")}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-sm text-pretty">
                  {jobIds.length > 0 ? (
                    <Trans>
                      This also releases {jobIds.length} jobs (
                      {jobIds.join(", ")}). They become available to the shop
                      floor and drive purchasing and production.
                    </Trans>
                  ) : (
                    <Trans>
                      The batch goes to the shop floor. Its jobs are already
                      released.
                    </Trans>
                  )}
                </p>
              )}

              {blocked.length === 0 && readiness.suppliers.length > 0 && (
                <>
                  <Alert>
                    <LuShoppingCart />
                    <AlertTitle>
                      <Trans>Purchase orders required</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        Each supplier's outside operations from every job go on
                        one new purchase order, or on an existing draft you
                        choose.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                  {readiness.suppliers.map((supplier) => (
                    <div
                      key={supplier.supplierId}
                      className="flex w-full items-center justify-between rounded-lg border p-4 text-sm"
                    >
                      <SupplierAvatar supplierId={supplier.supplierId} />
                      <Select
                        size="sm"
                        value={purchaseOrders[supplier.supplierId] ?? "new"}
                        isReadOnly={supplier.draftPurchaseOrders.length === 0}
                        options={[
                          { value: "new", label: t`Create New` },
                          ...supplier.draftPurchaseOrders.map((po) => ({
                            value: po.id,
                            label: po.purchaseOrderId
                          }))
                        ]}
                        onChange={(value) =>
                          setPurchaseOrders((prev) => ({
                            ...prev,
                            [supplier.supplierId]: value
                          }))
                        }
                      />
                    </div>
                  ))}
                </>
              )}
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!canRelease}
            isLoading={isSubmitting}
            onClick={() =>
              onConfirm(
                readiness?.suppliers.length ? purchaseOrders : undefined
              )
            }
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
