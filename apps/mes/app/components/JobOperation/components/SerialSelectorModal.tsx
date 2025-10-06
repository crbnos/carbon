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
  VStack,
} from "@carbon/react";
import { useState } from "react";
import type { TrackedEntity } from "~/services/types";

import { LuCheck, LuList, LuQrCode, LuX } from "react-icons/lu";

export function SerialSelectorModal({
  availableEntities,
  onCancel,
  onClose,
  onSelect,
}: {
  availableEntities: TrackedEntity[];
  onCancel: () => void;
  onClose: () => void;
  onSelect: (entity: TrackedEntity) => void;
}) {
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
          <ModalTitle>Select Serial Number</ModalTitle>
          <ModalDescription>
            Select a serial number to continue with this operation
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Tabs defaultValue="scan">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="scan">
                <LuQrCode className="mr-2" />
                Scan
              </TabsTrigger>
              <TabsTrigger value="select">
                <LuList className="mr-2" />
                Select
              </TabsTrigger>
            </TabsList>
            <TabsContent value="select" className="mt-4">
              <ScrollArea className="max-h-[40dvh]">
                <VStack spacing={2}>
                  {availableEntities.length === 0 ? (
                    <p className="text-center text-muted-foreground">
                      No available serial numbers found
                    </p>
                  ) : (
                    availableEntities.map((entity) => {
                      return (
                        <HStack
                          key={entity.id}
                          className="w-full justify-between p-4 border rounded-md"
                        >
                          <VStack spacing={1} className="w-full items-start">
                            <p className="text-sm">{entity.id}</p>
                          </VStack>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onSelect(entity)}
                          >
                            Select
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
                    placeholder="Scan or enter serial number"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const entity = availableEntities.find(
                          (entity) => entity.id === e.currentTarget.value
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
                        (entity) => entity.id === serial
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
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
