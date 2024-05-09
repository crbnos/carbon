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
import { Contact, New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { CustomerContact } from "~/modules/sales/types";
import { path } from "~/utils/path";

type CustomerContactsProps = {
  contacts: CustomerContact[];
};

const CustomerContacts = ({ contacts }: CustomerContactsProps) => {
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  const permissions = usePermissions();
  const canEdit = permissions.can("create", "sales");
  const isEmpty = contacts === undefined || contacts?.length === 0;

  const deleteContactModal = useDisclosure();
  const [contact, setSelectedContact] = useState<CustomerContact | null>(null);

  const getActions = useCallback(
    (contact: CustomerContact) => {
      const actions = [];

      actions.push({
        label: permissions.can("update", "sales")
          ? "Edit Contact"
          : "View Contact",
        icon: <LuPencil />,
        onClick: () => {
          navigate(contact.id);
        },
      });

      if (permissions.can("delete", "sales")) {
        actions.push({
          label: "Delete Contact",
          icon: <LuTrash />,
          onClick: () => {
            setSelectedContact(contact);
            deleteContactModal.onOpen();
          },
        });
      }

      if (permissions.can("create", "users") && contact.user === null) {
        actions.push({
          label: "Create Account",
          icon: <IoMdAdd />,
          onClick: () => {
            navigate(
              `${path.to.newCustomerAccount}?id=${contact.id}&customer=${customerId}`
            );
          },
        });
      }

      return actions;
    },
    [permissions, deleteContactModal, navigate, customerId]
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          {isEmpty ? (
            <div className="w-full my-8 text-center">
              <p className="text-muted-foreground text-sm">
                You haven’t created any contacts yet.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col w-full gap-4">
              {contacts?.map((contact) => (
                <li key={contact.id}>
                  {contact.contact &&
                  !Array.isArray(contact.contact) &&
                  !Array.isArray(contact.user) ? (
                    <Contact
                      contact={contact.contact}
                      url={path.to.customerContact(customerId, contact.id!)}
                      user={contact.user}
                      actions={getActions(contact)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {contact && contact.id && (
        <ConfirmDelete
          action={path.to.deleteCustomerContact(customerId, contact.id)}
          isOpen={deleteContactModal.isOpen}
          name={`${contact?.contact?.firstName} ${contact?.contact?.lastName}`}
          text="Are you sure you want to delete this contact?"
          onCancel={deleteContactModal.onClose}
          onSubmit={deleteContactModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerContacts;
