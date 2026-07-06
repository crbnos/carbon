import {
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

export function SerialSelectorModal({
  availableEntities,
  onCancel,
  onClose,
  onSelect
}: {
  availableEntities: TrackedEntity[];
  onCancel: () => void;
  onClose: () => void;
  onSelect: (entity: TrackedEntity) => void;
}) {
  const { t } = useLingui();
  const [serial, setSerial] = useState("");

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Select Serial Number</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Select a serial number to continue with this operation
            </Trans>
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
                  {availableEntities.length === 0 ? (
                    <p className="text-center text-muted-foreground">
                      <Trans>No available serial numbers found</Trans>
                    </p>
                  ) : (
                    availableEntities.map((entity) => {
                      return (
                        <HStack
                          key={entity.id}
                          className="w-full justify-between p-4 border rounded-md"
                        >
                          <VStack spacing={0} className="w-full items-start">
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
                            <Trans>Select</Trans>
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
                    placeholder={t`Scan or enter serial number`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = e.currentTarget.value;
                        const entity = availableEntities.find(
                          (entity) =>
                            entity.id === val || entity.readableId === val
                        );
                        if (entity) {
                          onSelect(entity);
                        }
                      }
                    }}
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                  />
                  <InputRightElement>
                    {serial &&
                      (availableEntities.some(
                        (entity) =>
                          entity.id === serial || entity.readableId === serial
                      ) ? (
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
      </ModalContent>
    </Modal>
  );
}
