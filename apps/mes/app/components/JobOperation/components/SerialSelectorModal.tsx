// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuList, LuQrCode, LuX } from "react-icons/lu";
import type { TrackedEntity } from "~/services/types";
import { parseTravelerCode } from "~/utils/traveler";
import {
  holdingIssueLabel,
  holdingIssues,
  type UnitHolds
} from "~/utils/unitHold";

/** The unit a typed or pasted value names: its id, its serial, or its label's traveler link. */
function findEntity(entities: TrackedEntity[], value: string) {
  const code = value.trim();
  if (!code) return undefined;
  const id = parseTravelerCode(code) ?? code;
  return entities.find(
    (entity) => entity.id === id || entity.readableId === code
  );
}

export function SerialSelectorModal({
  availableEntities,
  onHoldEntities = [],
  unitHolds,
  open = true,
  onCancel,
  onClose,
  onSelect
}: {
  availableEntities: TrackedEntity[];
  /**
   * Units still to do here that are on hold for an open quality issue. Listed
   * after the available ones, with the issue; selecting one only shows it.
   */
  onHoldEntities?: TrackedEntity[];
  unitHolds?: UnitHolds;
  open?: boolean;
  onCancel: () => void;
  onClose: () => void;
  onSelect: (entity: TrackedEntity) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <SerialSelectorBody
          availableEntities={availableEntities}
          onHoldEntities={onHoldEntities}
          unitHolds={unitHolds}
          onCancel={onCancel}
          onSelect={onSelect}
        />
      </ModalContent>
    </Modal>
  );
}

function SerialSelectorBody({
  availableEntities,
  onHoldEntities,
  unitHolds,
  onCancel,
  onSelect
}: {
  availableEntities: TrackedEntity[];
  onHoldEntities: TrackedEntity[];
  unitHolds?: UnitHolds;
  onCancel: () => void;
  onSelect: (entity: TrackedEntity) => void;
}) {
  const { t } = useLingui();
  const [serial, setSerial] = useState("");
  // A scan of a unit on hold opens it, so the operator sees why it waits.
  const scannable = [...availableEntities, ...onHoldEntities];
  const match = findEntity(scannable, serial);

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Select Serial Number</Trans>
        </ModalTitle>
        <ModalDescription>
          <Trans>Select a serial number to continue with this operation</Trans>
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <Tabs defaultValue="scan">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="scan">
              <LuQrCode className="mr-2" />
              <Trans>Scan</Trans>
            </TabsTrigger>
            <TabsTrigger value="select">
              <LuList className="mr-2" />
              <Trans>Select</Trans>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="select" className="mt-4">
            <ScrollArea className="max-h-[40dvh]">
              <VStack spacing={2}>
                {scannable.length === 0 ? (
                  <p className="text-center text-muted-foreground">
                    <Trans>No available serial numbers found</Trans>
                  </p>
                ) : (
                  scannable.map((entity) => {
                    const issueNumbers = holdingIssues(unitHolds, entity.id)
                      .map(holdingIssueLabel)
                      .join(", ");
                    return (
                      <HStack
                        key={entity.id}
                        className="w-full justify-between p-4 border rounded-md"
                      >
                        <VStack spacing={0} className="w-full items-start">
                          {issueNumbers ? (
                            <Badge variant="red" className="mb-1">
                              <Trans>On hold · {issueNumbers}</Trans>
                            </Badge>
                          ) : null}
                          {entity.readableId ? (
                            <>
                              <p className="text-sm font-medium">
                                {entity.readableId}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {entity.id}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground font-mono">
                              {entity.id}
                            </p>
                          )}
                        </VStack>
                        <Button
                          size="lg"
                          variant="secondary"
                          onClick={() => onSelect(entity)}
                        >
                          {issueNumbers ? (
                            <Trans>View</Trans>
                          ) : (
                            <Trans>Select</Trans>
                          )}
                        </Button>
                      </HStack>
                    );
                  })
                )}
              </VStack>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="scan" className="mt-4">
            <VStack spacing={4}>
              <InputGroup>
                <Input
                  autoFocus
                  size="lg"
                  aria-label={t`Serial number`}
                  // The ✓/✗ beside the field is the only other cue.
                  aria-invalid={serial && !match ? true : undefined}
                  placeholder={t`Scan or enter serial number`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const entity = findEntity(
                        scannable,
                        e.currentTarget.value
                      );
                      if (entity) {
                        onSelect(entity);
                      }
                    }
                  }}
                  onPaste={(e) => {
                    const entity = findEntity(
                      scannable,
                      e.clipboardData.getData("text")
                    );
                    if (entity) {
                      e.preventDefault();
                      onSelect(entity);
                    }
                  }}
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
                <InputRightElement>
                  {serial &&
                    (match ? (
                      <LuCheck className="text-green-500" />
                    ) : (
                      <LuX className="text-red-500" />
                    ))}
                </InputRightElement>
              </InputGroup>
            </VStack>
          </TabsContent>
        </Tabs>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="lg" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </ModalFooter>
    </>
  );
}
