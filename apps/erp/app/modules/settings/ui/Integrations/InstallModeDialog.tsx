// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  RadioGroup,
  RadioGroupButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck } from "react-icons/lu";

export type InstallMode = {
  id: string;
  label: string;
  description: string;
};

/**
 * Pick an install mode BEFORE consent.
 *
 * Deliberately not a `ValidatedForm`: nothing is persisted at this point. The
 * mode is a redirect parameter to the connect route, which turns it into the
 * requested OAuth scopes server-side.
 *
 * The copy has to carry one awkward fact plainly — the platform does not name
 * this role. Brex, BILL and Coupa all expose an explicit "spend without the
 * ledger" posture and Ramp does not, so Carbon is building on its scope split
 * rather than a documented product mode. A customer choosing here is choosing
 * something they cannot go and verify in Ramp's own UI, and the dialog should not
 * imply otherwise.
 */
export function InstallModeDialog({
  integrationName,
  modes,
  onClose,
  onChoose
}: {
  integrationName: string;
  modes: InstallMode[];
  onClose: () => void;
  onChoose: (modeId: string) => void;
}) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<string | null>(modes[0]?.id ?? null);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>How will you use {integrationName}?</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              This cannot be changed later — {integrationName} allows only one
              connected accounting system, so the choice decides what Carbon is
              permitted to do. To switch, you would uninstall and reconnect.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {/* A real radio group, not N `aria-pressed` buttons: one tab stop,
              arrow keys move between the options, and a screen reader is told
              they are mutually exclusive. `RadioGroupButton` leaves Enter free
              for Continue below, which is exactly this screen's shape. */}
          <RadioGroup
            value={selected ?? undefined}
            onValueChange={setSelected}
            aria-label={t`Install mode`}
            className="flex flex-col gap-3"
          >
            {modes.map((mode) => {
              const isSelected = selected === mode.id;
              return (
                <RadioGroupButton
                  key={mode.id}
                  value={mode.id}
                  autoFocus={isSelected}
                  className={cn(
                    // The options read as cards, so drop the button size's fixed
                    // height and single-line clamp.
                    "h-auto w-full items-start justify-start whitespace-normal rounded-lg border p-4 text-left",
                    isSelected
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground"
                    )}
                  >
                    {isSelected && <LuCheck className="size-3" />}
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{mode.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {mode.description}
                    </span>
                  </span>
                </RadioGroupButton>
              );
            })}
          </RadioGroup>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!selected}
            onClick={() => selected && onChoose(selected)}
          >
            <Trans>Continue</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
