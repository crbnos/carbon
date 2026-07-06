import {
  Badge,
  Button,
  Checkbox,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { loader as cancelPreviewLoader } from "~/routes/x+/sales-order+/$orderId.cancel-preview";
import { path } from "~/utils/path";

type CancelPreviewResponse =
  Awaited<ReturnType<typeof cancelPreviewLoader>> extends { jobs: infer J }
    ? { jobs: J }
    : never;

type Props = {
  orderId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  isSubmitting: boolean;
};

export function CancelSalesOrderModal({
  orderId,
  isOpen,
  onClose,
  onSubmit,
  isSubmitting
}: Props) {
  const { t } = useLingui();
  const previewFetcher = useFetcher<CancelPreviewResponse>();

  const [selection, setSelection] = useState<Set<string> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!isOpen) return;
    previewFetcher.load(path.to.salesOrderCancelPreview(orderId));
  }, [isOpen, orderId]);

  useEffect(() => {
    if (!isOpen) setSelection(null);
  }, [isOpen]);

  const jobs = previewFetcher.data?.jobs ?? [];
  const isLoading = previewFetcher.state !== "idle" && !previewFetcher.data;

  const selectedJobIds = useMemo(
    () => selection ?? new Set(jobs.map((j) => j.id)),
    [selection, jobs]
  );

  const allSelected = jobs.length > 0 && selectedJobIds.size === jobs.length;
  const someSelected = selectedJobIds.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelection(allSelected ? new Set() : new Set(jobs.map((j) => j.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedJobIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection(next);
  };

  const selectedIds = useMemo(
    () => Array.from(selectedJobIds),
    [selectedJobIds]
  );

  const submit = (includeJobs: boolean) => {
    const fd = new FormData();
    fd.set("status", "Cancelled");
    fd.set("cancelJobIds", includeJobs ? selectedIds.join(",") : "");
    onSubmit(fd);
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Cancel Sales Order</Trans>
          </ModalTitle>
          {!isLoading && jobs.length > 0 && (
            <ModalDescription>
              <Trans>
                This sales order has associated jobs. Choose what to do with
                them.
              </Trans>
            </ModalDescription>
          )}
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Loading associated jobs...</Trans>
            </p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No active jobs found for this sales order. The order will be
                cancelled directly.
              </Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              <HStack className="px-1">
                <Checkbox
                  isChecked={allSelected}
                  isIndeterminate={someSelected}
                  onCheckedChange={toggleAll}
                />
                <span className="text-xs uppercase text-muted-foreground">
                  <Trans>Select all</Trans>
                </span>
              </HStack>
              <div className="max-h-[320px] w-full overflow-y-auto">
                {jobs.map((job) => (
                  <label
                    key={job.id}
                    className="flex items-center gap-3 border-b last:border-b-0 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      isChecked={selectedJobIds.has(job.id)}
                      onCheckedChange={() => toggleOne(job.id)}
                    />
                    <HStack className="py-2">
                      <div className="text-sm font-medium truncate">
                        {job.jobReadableId}
                        {job.itemReadableId && (
                          <span className="ml-2 text-muted-foreground font-normal">
                            {job.itemReadableId}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{job.status}</Badge>
                        {job.dueDate && <span>Due {job.dueDate}</span>}
                      </div>
                    </HStack>
                  </label>
                ))}
              </div>
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>
              <Trans>Back</Trans>
            </Button>
            {jobs.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => submit(false)}
                isDisabled={isSubmitting}
                isLoading={isSubmitting}
              >
                <Trans>Cancel SO only</Trans>
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => submit(jobs.length > 0)}
              isDisabled={
                isSubmitting || (jobs.length > 0 && selectedJobIds.size === 0)
              }
              isLoading={isSubmitting}
            >
              {jobs.length === 0
                ? t`Cancel SO`
                : selectedJobIds.size === jobs.length
                  ? t`Cancel SO + ${selectedIds.length} job${selectedIds.length === 1 ? "" : "s"}`
                  : t`Cancel SO + ${selectedIds.length} selected`}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
