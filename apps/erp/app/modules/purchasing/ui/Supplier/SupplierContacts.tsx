// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { IoMdAdd } from "react-icons/io";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { Contact, New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { SupplierContact } from "~/modules/purchasing/types";
import { path } from "~/utils/path";

type SupplierContactsProps = {
  contacts: SupplierContact[];
};

const SupplierContacts = ({ contacts }: SupplierContactsProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");
  const permissions = usePermissions();
  const canEdit = permissions.can("create", "purchasing");
  const isEmpty = contacts === undefined || contacts?.length === 0;

  const deleteContactModal = useDisclosure();
  const [selectedContact, setSelectedContact] = useState<SupplierContact>();

  const getActions = useCallback(
    (contact: SupplierContact) => {
      const actions = [];
      actions.push({
        label: permissions.can("update", "purchasing")
          ? t`Edit Contact`
          : t`View Contact`,
        icon: <LuPencil />,
        onClick: () => {
          navigate(contact.id);
        }
      });

      if (permissions.can("delete", "purchasing")) {
        actions.push({
          label: t`Delete Contact`,
          destructive: true,
          icon: <LuTrash />,
          onClick: () => {
            setSelectedContact(contact);
            deleteContactModal.onOpen();
          }
        });
      }

      if (
        permissions.can("create", "users") &&
        contact.user === null &&
        contact.contact.email
      ) {
        actions.push({
          label: t`Create Account`,
          icon: <IoMdAdd />,
          onClick: () => {
            navigate(
              `${path.to.newSupplierAccount}?id=${contact.id}&supplier=${supplierId}`
            );
          }
        });
      }

      if (permissions.can("create", "resources")) {
        actions.push({
          label: t`Add Contractor`,
          icon: <IoMdAdd />,
          onClick: () => {
            navigate(
              `${path.to.newContractor}?id=${contact.id}&supplierId=${supplierId}`
            );
          }
        });
      }

      return actions;
    },
    [permissions, deleteContactModal, navigate, supplierId, t]
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Contacts</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          {isEmpty ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>You haven't created any contacts yet.</Trans>
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
                      url={path.to.supplierContact(supplierId, contact.id)}
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

      {selectedContact && selectedContact.id && (
        <ConfirmDelete
          action={path.to.deleteSupplierContact(supplierId, selectedContact.id)}
          isOpen={deleteContactModal.isOpen}
          name={
            selectedContact.contact?.fullName ??
            selectedContact.contact?.email ??
            "Unknown"
          }
          text="Are you sure you want to delete this contact?"
          onCancel={deleteContactModal.onClose}
          onSubmit={deleteContactModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default SupplierContacts;
