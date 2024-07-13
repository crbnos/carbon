import {
  ActionMenu,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  Enumerable,
  HStack,
  VStack,
  useDisclosure,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import { useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { ConfirmDelete } from "~/components/Modals";
import { useUrlParams } from "~/hooks";
import type { EquipmentTypeDetailType } from "~/modules/resources";
import { path } from "~/utils/path";

type Equipment = {
  id: string;
  name: string;
};

type EquipmentTypeDetailProps = {
  equipmentType: EquipmentTypeDetailType;
  onClose: () => void;
};

const EquipmentTypeDetail = ({
  equipmentType,
  onClose,
}: EquipmentTypeDetailProps) => {
  const [params] = useUrlParams();

  const deleteModal = useDisclosure();
  const [selectedEquipment, setSelectedEquipment] = useState<
    Equipment | undefined
  >();

  const onDelete = (data?: Equipment) => {
    setSelectedEquipment(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedEquipment(undefined);
    deleteModal.onClose();
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{equipmentType.name}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            {Array.isArray(equipmentType?.equipment) && (
              <VStack spacing={4}>
                {equipmentType.equipment.map((equipment) => {
                  return (
                    <HStack key={equipment.id} className="w-full">
                      <VStack spacing={1} className="flex-grow">
                        <HStack>
                          <span className="font-bold">{equipment.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {equipment.equipmentId ?? null}
                          </span>
                        </HStack>
                        <Enumerable value={equipment?.location?.name ?? null} />
                      </VStack>
                      <ActionMenu>
                        <DropdownMenuItem asChild>
                          <Link to={equipment.id}>
                            <DropdownMenuIcon icon={<LuPencil />} />
                            Edit Unit
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDelete(equipment)}>
                          <DropdownMenuIcon icon={<LuTrash />} />
                          Delete Unit
                        </DropdownMenuItem>
                      </ActionMenu>
                    </HStack>
                  );
                })}
              </VStack>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button asChild leftIcon={<LuPlus />} size="md">
              <Link to={`new?${params.toString()}`}>New Equipment</Link>
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {selectedEquipment && selectedEquipment.id && (
        <ConfirmDelete
          isOpen={deleteModal.isOpen}
          action={path.to.deleteEquipment(selectedEquipment.id)}
          name={selectedEquipment?.name ?? ""}
          text={`Are you sure you want to deactivate ${selectedEquipment?.name}?`}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
};

export default EquipmentTypeDetail;
