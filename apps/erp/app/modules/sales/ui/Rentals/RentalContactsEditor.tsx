// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuStar, LuTrash } from "react-icons/lu";
import { CustomerContact } from "~/components/Form";
import type { getCustomerContacts } from "~/modules/sales/sales.service";
import { path } from "~/utils/path";
import PrimaryContactRole from "./PrimaryContactRole";

export type RentalContactsValue = {
  /** The primary contact: on every invoice, and the one emailed. */
  primaryId: string | undefined;
  /** In the order they were added. */
  contacts: { customerContactId: string; role?: string | null }[];
};

type RentalContactsEditorProps = {
  customerId: string;
  value: RentalContactsValue;
  onChange: (value: RentalContactsValue) => void;
  isReadOnly?: boolean;
  /** A save is in flight: edits wait for it. */
  isBusy?: boolean;
};

/** An agreement's contacts table: setup step 1 keeps the value in its form,
 *  the agreement page saves it on every change. The first contact added is
 *  the primary one. */
const RentalContactsEditor = ({
  customerId,
  value,
  onChange,
  isReadOnly = false,
  isBusy = false
}: RentalContactsEditorProps) => {
  const { t } = useLingui();
  const customerContacts = useLoaderQuery<
    Awaited<ReturnType<typeof getCustomerContacts>>
  >(customerId ? path.to.api.customerContacts(customerId) : null);
  const byId = new Map(
    (customerContacts.data?.data ?? []).map((row) => [row.id, row.contact])
  );

  const rows = [
    ...(value.primaryId
      ? [{ customerContactId: value.primaryId, role: null, isPrimary: true }]
      : []),
    ...value.contacts.map((row) => ({ ...row, isPrimary: false }))
  ];

  // The first contact added is the primary one.
  const add = (customerContactId: string) => {
    if (rows.some((row) => row.customerContactId === customerContactId)) return;
    onChange(
      value.primaryId
        ? { ...value, contacts: [...value.contacts, { customerContactId }] }
        : { ...value, primaryId: customerContactId }
    );
  };

  const remove = (customerContactId: string) => {
    if (customerContactId !== value.primaryId) {
      onChange({
        ...value,
        contacts: value.contacts.filter(
          (row) => row.customerContactId !== customerContactId
        )
      });
      return;
    }
    // The next contact takes over as primary.
    const [next, ...rest] = value.contacts;
    onChange({ primaryId: next?.customerContactId, contacts: rest });
  };

  const makePrimary = (customerContactId: string) => {
    onChange({
      primaryId: customerContactId,
      contacts: [
        ...(value.primaryId ? [{ customerContactId: value.primaryId }] : []),
        ...value.contacts.filter(
          (row) => row.customerContactId !== customerContactId
        )
      ]
    });
  };

  const setRole = (customerContactId: string, role: string) => {
    onChange({
      ...value,
      contacts: value.contacts.map((row) =>
        row.customerContactId === customerContactId ? { ...row, role } : row
      )
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Contacts</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Who to call about this rental. The first contact you add is the
            primary one.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 && (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Name</Trans>
                </Th>
                <Th>
                  <Trans>Role</Trans>
                </Th>
                <Th>
                  <Trans>Email</Trans>
                </Th>
                <Th>
                  <Trans>Phone</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const contact = byId.get(row.customerContactId);
                const name = contact?.fullName || contact?.email || "—";
                return (
                  <Tr key={row.customerContactId}>
                    <Td>{name}</Td>
                    <Td>
                      {row.isPrimary ? (
                        <PrimaryContactRole />
                      ) : (
                        <RoleInput
                          key={row.role ?? ""}
                          role={row.role ?? ""}
                          isReadOnly={isReadOnly || isBusy}
                          onCommit={(role) =>
                            setRole(row.customerContactId, role)
                          }
                        />
                      )}
                    </Td>
                    <Td>{contact?.email ?? ""}</Td>
                    <Td className="tabular-nums">
                      {contact?.workPhone || contact?.mobilePhone || ""}
                    </Td>
                    <Td className="text-right">
                      {!isReadOnly && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              type="button"
                              aria-label={t`Actions for ${name}`}
                              icon={<LuEllipsisVertical />}
                              variant="ghost"
                              size="sm"
                              isDisabled={isBusy}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            {!row.isPrimary && (
                              <DropdownMenuItem
                                onClick={() =>
                                  makePrimary(row.customerContactId)
                                }
                              >
                                <DropdownMenuIcon icon={<LuStar />} />
                                <Trans>Make Primary</Trans>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              destructive
                              onClick={() => remove(row.customerContactId)}
                            >
                              <DropdownMenuIcon icon={<LuTrash />} />
                              <Trans>Remove</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}

        {!isReadOnly && (
          <CustomerContact
            name="contactToAdd"
            label={t`Add Contact`}
            customer={customerId}
            value=""
            isReadOnly={!customerId || isBusy}
            onChange={(contact) => {
              if (contact?.id) add(contact.id);
            }}
          />
        )}
        {isReadOnly && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Trans>No contacts.</Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
};

/** A role, saved when the field loses focus or on Enter, so the page does
 *  not save on every keystroke and Enter never submits the setup step. */
const RoleInput = ({
  role,
  isReadOnly,
  onCommit
}: {
  role: string;
  isReadOnly: boolean;
  onCommit: (role: string) => void;
}) => {
  const { t } = useLingui();
  const [draft, setDraft] = useState(role);
  const commit = () => {
    if (draft.trim() !== role) onCommit(draft.trim());
  };
  return (
    <Input
      size="sm"
      aria-label={t`Role`}
      placeholder={t`For example Site or Ordered by`}
      maxLength={50}
      isReadOnly={isReadOnly}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
};

export default RentalContactsEditor;
