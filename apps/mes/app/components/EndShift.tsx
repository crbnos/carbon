import { useCarbon } from "@carbon/auth";
import {
  Button,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  useDisclosure,
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { FaFlagCheckered } from "react-icons/fa6";
import { useUser } from "~/hooks";
import type { action } from "~/routes/x+/end-shift.tsx";
import {
  getActiveJobOperationsByEmployee,
  type Operation,
} from "~/services/jobs.service";
import { path } from "~/utils/path";

export const EndShift = ({ isCollapsed }: { isCollapsed: boolean }) => {
  const confirmModal = useDisclosure();
  const fetcher = useFetcher<typeof action>();
  const user = useUser();
  const { carbon } = useCarbon();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success === true) {
      confirmModal.onClose();
      toast.success(fetcher.data?.message ?? "Shift ended");
    }

    if (fetcher.data?.success === false) {
      toast.error(fetcher.data?.message ?? "Failed to end shift");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data?.success]);

  console.log({ fetcher });

  const openModal = async () => {
    flushSync(() => {
      setLoading(true);
      confirmModal.onOpen();
    });

    if (!carbon) return;
    const { data, error } = await getActiveJobOperationsByEmployee(carbon, {
      employeeId: user.id,
      companyId: user.company.id,
    });
    if (error) {
      toast.error("Failed to fetch active operations");
    }
    setOperations((data ?? []) as Operation[]);
    setLoading(false);
  };

  return (
    <>
      {isCollapsed ? (
        <IconButton
          variant="destructive"
          size="lg"
          icon={<FaFlagCheckered className="h-4 w-4" />}
          aria-label="End Shift"
          onClick={openModal}
        />
      ) : (
        <Button size="lg" variant="destructive" onClick={openModal}>
          End Shift
        </Button>
      )}
      {confirmModal.isOpen && (
        <Modal
          open={confirmModal.isOpen}
          onOpenChange={(open) => !open && confirmModal.onClose()}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>End Shift</ModalTitle>
              <ModalDescription>
                Are you sure you want to end all production events? This will
                end all active operations without completing or finishing them.
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              {loading ? (
                <div className="flex items-center justify-center w-full h-24">
                  <Spinner />
                </div>
              ) : operations?.length === 0 ? (
                <div className="flex items-center justify-center w-full h-24 text-muted-foreground">
                  No active operations
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {operations.map((operation) => (
                    <div
                      key={operation.id}
                      className="flex items-start justify-between p-4 rounded-lg border"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">
                          {operation.jobReadableId}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {operation.description}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-sm text-muted-foreground">
                          {operation.itemReadableId}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ModalBody>
            <fetcher.Form
              method="post"
              action={path.to.endShift}
              className="w-full"
            >
              <ModalFooter>
                <Button
                  type="button"
                  onClick={confirmModal.onClose}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <input
                  type="hidden"
                  name="timezone"
                  value={getLocalTimeZone()}
                />
                <Button
                  type="submit"
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={fetcher.state !== "idle"}
                  variant="destructive"
                >
                  End Shift
                </Button>
              </ModalFooter>
            </fetcher.Form>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};
