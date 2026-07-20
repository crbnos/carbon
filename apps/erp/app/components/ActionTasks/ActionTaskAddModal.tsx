import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type { ListItem } from "~/types";

// The shared "Add Actions" affordance used by Quality issues and Change Orders:
// a dashed button opening a modal that picks from the entity's required-action
// templates. Submission is delegated to `onAdd` (each caller wires its route);
// `isSubmitting` drives the button state and closing on success is the caller's
// job (re-render with the new tasks removes the modal via `isSubmitting` reset).
export function ActionTaskAddModal({
  templates,
  onAdd,
  isSubmitting = false,
  isDisabled = false,
  emptyMessage
}: {
  templates: ListItem[];
  onAdd: (selectedIds: string[]) => void;
  isSubmitting?: boolean;
  isDisabled?: boolean;
  emptyMessage?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSelectedIds([]);
  }, []);

  const onToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    );
  }, []);

  // Close once a submit resolves (isSubmitting true → false). The caller owns
  // the fetcher; an error surfaces via flash, so closing on resolve is fine.
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (wasSubmitting.current && !isSubmitting) close();
    wasSubmitting.current = isSubmitting;
  }, [isSubmitting, close]);

  return (
    <>
      <button
        type="button"
        className="flex items-center justify-start bg-card border-2 border-dashed border-background w-full hover:bg-background/80 rounded-lg px-10 py-6 text-muted-foreground hover:text-foreground gap-2 transition-colors duration-200 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setIsOpen(true)}
        disabled={isDisabled}
      >
        <LuCirclePlus size={16} />
        <span>
          <Trans>Add Actions</Trans>
        </span>
      </button>

      <Modal
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Actions</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={2}>
              {templates.length === 0 && emptyMessage && (
                <span className="text-sm text-muted-foreground">
                  {emptyMessage}
                </span>
              )}
              {templates.map((template) => (
                <label
                  key={template.id}
                  htmlFor={template.id}
                  className="flex items-center gap-2 w-full px-4 py-3 rounded-lg hover:bg-accent hover:text-accent-foreground border border-border cursor-pointer"
                >
                  <Checkbox
                    id={template.id}
                    isChecked={selectedIds.includes(template.id)}
                    onCheckedChange={(checked) =>
                      onToggle(template.id, !!checked)
                    }
                  />
                  <span className="text-sm font-medium">{template.name}</span>
                </label>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={() => onAdd(selectedIds)}
              isDisabled={selectedIds.length === 0 || isSubmitting}
              isLoading={isSubmitting}
            >
              <Trans>Add Actions</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
