import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useBuilderStore } from "./context";

/** Walk `data` recursively counting how many ref values point to `nodeId`. */
function countRefsTo(data: unknown, nodeId: string): number {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data)) {
    return data.reduce(
      (sum: number, item) => sum + countRefsTo(item, nodeId),
      0
    );
  }
  const obj = data as Record<string, unknown>;
  if (obj.kind === "ref" && obj.nodeId === nodeId) return 1;
  return Object.values(obj).reduce(
    (sum: number, v) => sum + countRefsTo(v, nodeId),
    0
  );
}

type DeleteNodeDialogProps = {
  nodeId: string;
  onClose: () => void;
};

export function DeleteNodeDialog({ nodeId, onClose }: DeleteNodeDialogProps) {
  const nodes = useBuilderStore((s) => s.nodes);
  const removeNode = useBuilderStore((s) => s.removeNode);

  // Count how many other nodes reference this node's outputs
  const downstreamCount = nodes
    .filter((n) => n.id !== nodeId)
    .reduce((sum, n) => sum + countRefsTo(n.data, nodeId), 0);

  function handleConfirm() {
    removeNode(nodeId);
    onClose();
  }

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
            <Trans>Delete this step?</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          {downstreamCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                {downstreamCount}{" "}
                {downstreamCount === 1 ? "later step uses" : "later steps use"}{" "}
                this step. Those references will be broken and shown as "Step
                removed" until you reconnect them.
              </Trans>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>
                This step and its connections will be removed. This cannot be
                undone.
              </Trans>
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            <Trans>Delete step</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
