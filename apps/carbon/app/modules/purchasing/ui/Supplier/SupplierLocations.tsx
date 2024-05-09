import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  useDisclosure,
} from "@carbon/react";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import { useCallback, useState } from "react";
import { IoMdAdd } from "react-icons/io";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Address, New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { SupplierLocation } from "~/modules/purchasing/types";
import { path } from "~/utils/path";

type SupplierLocationsProps = {
  locations: SupplierLocation[];
};

const SupplierLocations = ({ locations }: SupplierLocationsProps) => {
  const navigate = useNavigate();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");
  const permissions = usePermissions();
  const canEdit = permissions.can("create", "purchasing");
  const isEmpty = locations === undefined || locations?.length === 0;

  const deleteLocationModal = useDisclosure();
  const [selectedLocation, setSelectedLocation] = useState<SupplierLocation>();

  const getActions = useCallback(
    (location: SupplierLocation) => {
      const actions = [];
      if (permissions.can("update", "purchasing")) {
        actions.push({
          label: "Edit Location",
          icon: <LuPencil />,
          onClick: () => {
            navigate(location.id);
          },
        });
      }
      if (permissions.can("delete", "purchasing")) {
        actions.push({
          label: "Delete Location",
          icon: <LuTrash />,
          onClick: () => {
            setSelectedLocation(location);
            deleteLocationModal.onOpen();
          },
        });
      }

      if (permissions.can("create", "resources")) {
        actions.push({
          label: "Add Partner",
          icon: <IoMdAdd />,
          onClick: () => {
            navigate(
              `${path.to.newPartner}?id=${location.id}&supplierId=${supplierId}`
            );
          },
        });
      }

      return actions;
    },
    [permissions, deleteLocationModal, navigate, supplierId]
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Locations</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          {isEmpty ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                You haven’t created any locations yet.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col w-full gap-4">
              {locations?.map((location) => (
                <li key={location.id}>
                  {location.address && !Array.isArray(location.address) ? (
                    <Address
                      address={location.address}
                      actions={getActions(location)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selectedLocation && selectedLocation.id && (
        <ConfirmDelete
          action={path.to.deleteSupplierLocation(
            supplierId,
            selectedLocation.id
          )}
          name={selectedLocation.address?.city ?? ""}
          text="Are you sure you want to delete this location?"
          isOpen={deleteLocationModal.isOpen}
          onCancel={deleteLocationModal.onClose}
          onSubmit={deleteLocationModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default SupplierLocations;
