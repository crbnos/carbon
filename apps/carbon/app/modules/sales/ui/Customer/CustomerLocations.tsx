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
import { LuPencil, LuTrash } from "react-icons/lu";
import { Location, New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { CustomerLocation } from "~/modules/sales";
import { path } from "~/utils/path";

type CustomerLocationsProps = {
  locations: CustomerLocation[];
};

const CustomerLocations = ({ locations }: CustomerLocationsProps) => {
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  const permissions = usePermissions();
  const canEdit = permissions.can("create", "sales");
  const isEmpty = locations === undefined || locations?.length === 0;

  const deleteLocationModal = useDisclosure();
  const [location, setSelectedLocation] = useState<CustomerLocation>();

  const getActions = useCallback(
    (location: CustomerLocation) => {
      const actions = [];
      if (permissions.can("update", "sales")) {
        actions.push({
          label: "Edit Location",
          icon: <LuPencil />,
          onClick: () => {
            navigate(location.id);
          },
        });
      }
      if (permissions.can("delete", "sales")) {
        actions.push({
          label: "Delete Location",
          icon: <LuTrash />,
          onClick: () => {
            setSelectedLocation(location);
            deleteLocationModal.onOpen();
          },
        });
      }

      return actions;
    },
    [permissions, deleteLocationModal, navigate]
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
                    <Location
                      location={location}
                      actions={getActions(location)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {deleteLocationModal.isOpen && location?.id && (
        <ConfirmDelete
          action={path.to.deleteCustomerLocation(customerId, location.id)}
          // @ts-ignore
          name={location?.address?.city ?? ""}
          text="Are you sure you want to delete this location?"
          onCancel={deleteLocationModal.onClose}
          onSubmit={deleteLocationModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerLocations;
