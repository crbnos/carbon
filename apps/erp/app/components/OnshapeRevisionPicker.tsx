import { OnshapeLogo } from "@carbon/ee";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { OnshapeRevision } from "./OnshapeRevisionSearch";
import { OnshapeRevisionSearch } from "./OnshapeRevisionSearch";

export type OnshapeSelection = OnshapeRevision;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: OnshapeSelection) => void;
  title: string;
  description: string;
  hideLinked?: boolean;
  confirmLabel: string;
  isSubmitting?: boolean;
  onlyElementType?: number;
};

/**
 * Pick a released Onshape revision, in a modal.
 *
 * The list itself is `OnshapeRevisionSearch` — this adds the dialog, a
 * confirm step and the already-linked refusal. Surfaces that are ALREADY a
 * modal (the new-part form) embed the search directly instead, rather than
 * stacking a second dialog over the one the user is filling in.
 */
export const OnshapeRevisionPicker = ({
  isOpen,
  onClose,
  onSelect,
  title,
  description,
  hideLinked = false,
  confirmLabel,
  isSubmitting = false,
  onlyElementType
}: Props) => {
  const { t } = useLingui();
  const [selected, setSelected] = useState<OnshapeSelection | null>(null);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
          onClose();
        }
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <HStack className="items-center gap-2">
            <OnshapeLogo className="h-5 w-auto" />
            <ModalTitle>{title}</ModalTitle>
          </HStack>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        {/* min-w-0 all the way down. ModalContent is a CSS GRID, and a grid
            item's default `min-width: auto` lets it size the track to its own
            max-content — so one 80-character Onshape part number widened the
            track to 1012px inside a 576px dialog and every row, the search box
            and the footer buttons rendered outside the panel. Filtering the
            long row away made it snap back, which is what made it look like a
            rendering glitch rather than a sizing rule. */}
        <ModalBody className="min-w-0">
          <OnshapeRevisionSearch
            isActive={isOpen}
            selected={selected}
            onSelect={setSelected}
            hideLinked={hideLinked}
            onlyElementType={onlyElementType}
          />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              variant="secondary"
              onClick={onClose}
              isDisabled={isSubmitting}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              isDisabled={!selected || isSubmitting}
              isLoading={isSubmitting}
              onClick={() => {
                if (!selected) return;
                if (selected.linked && hideLinked) {
                  toast.error(
                    t`That Onshape part is already linked to a Carbon item.`
                  );
                  return;
                }
                onSelect(selected);
              }}
            >
              {confirmLabel}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default OnshapeRevisionPicker;
