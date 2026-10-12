// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  indirectPoolAccountRoles,
  indirectPoolAccountValidator
} from "@carbon/ee/indirect-rates";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { Enumerable } from "~/components/Enumerable";
import {
  Account,
  Hidden,
  Select,
  SelectControlled,
  Submit
} from "~/components/Form";
import Confirm from "~/components/Modals/Confirm/Confirm";
import type { DimensionWithValues } from "../JournalEntries/types";

export type IndirectPoolAccountRow = {
  id: string;
  role: "Cost" | "Base";
  accountId: string;
  dimensionId: string | null;
  dimensionValueId: string | null;
  account: { number: string; name: string } | null;
  dimension: { name: string } | null;
};

type IndirectPoolAccountsProps = {
  poolId: string;
  accounts: IndirectPoolAccountRow[];
  /** Active dimensions with their values: the choices that narrow a mapping. */
  dimensions: DimensionWithValues[];
  action: string;
  isDisabled: boolean;
};

/**
 * The GL accounts a pool collects as cost or measures as its base. A mapping
 * narrowed by a dimension value wins over the account alone.
 */
const IndirectPoolAccounts = ({
  poolId,
  accounts,
  dimensions,
  action,
  isDisabled
}: IndirectPoolAccountsProps) => {
  const { t } = useLingui();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<IndirectPoolAccountRow | null>(null);
  const deleteDisclosure = useDisclosure();

  const valueName = useMemo(() => {
    const map = new Map<string, string>();
    for (const dimension of dimensions) {
      for (const value of dimension.values) map.set(value.id, value.name);
    }
    return map;
  }, [dimensions]);

  return (
    <div className="mt-6 flex w-full flex-col gap-2">
      <HStack className="w-full justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Accounts</Trans>
        </span>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={isDisabled}
          onClick={() => setAdding(true)}
        >
          <Trans>Add</Trans>
        </Button>
      </HStack>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            No accounts yet. Add the accounts this pool collects as cost, and
            any account that is part of its base.
          </Trans>
        </p>
      ) : (
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <Table full>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Role</Trans>
                </Th>
                <Th>
                  <Trans>Account</Trans>
                </Th>
                <Th>
                  <Trans>Dimension</Trans>
                </Th>
                <Th>
                  <Trans>Value</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {accounts.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Enumerable value={row.role} />
                  </Td>
                  <Td>
                    <div className="flex min-w-0 flex-col">
                      <span className="whitespace-nowrap tabular-nums">
                        {row.account?.number}
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {row.account?.name}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="line-clamp-1">
                      {row.dimension?.name ?? ""}
                    </span>
                  </Td>
                  <Td>
                    <span className="line-clamp-1">
                      {row.dimensionValueId
                        ? (valueName.get(row.dimensionValueId) ??
                          row.dimensionValueId)
                        : ""}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <IconButton
                      aria-label={t`Delete ${row.account?.number ?? ""}`}
                      icon={<LuTrash />}
                      variant="ghost"
                      size="sm"
                      isDisabled={isDisabled}
                      onClick={() => {
                        setDeleting(row);
                        deleteDisclosure.onOpen();
                      }}
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {adding && (
        <IndirectPoolAccountModal
          poolId={poolId}
          action={action}
          dimensions={dimensions}
          onClose={() => setAdding(false)}
        />
      )}

      {deleteDisclosure.isOpen && deleting && (
        <Confirm
          action={action}
          title={t`Remove ${deleting.account?.number ?? ""}`}
          text={t`Remove the account ${deleting.account?.number ?? ""} from this pool? Rates already computed keep it.`}
          confirmText={t`Remove`}
          confirmVariant="destructive"
          onCancel={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
        >
          <input type="hidden" name="intent" value="account-delete" />
          <input type="hidden" name="id" value={deleting.id} />
        </Confirm>
      )}
    </div>
  );
};

function IndirectPoolAccountModal({
  poolId,
  action,
  dimensions,
  onClose
}: {
  poolId: string;
  action: string;
  dimensions: DimensionWithValues[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });
  const [dimensionId, setDimensionId] = useState<string>("");

  // A dimension whose values are not listed here (customers, suppliers,
  // items) cannot narrow a mapping from this form.
  const choosable = dimensions.filter((d) => d.values.length > 0);
  const values =
    choosable.find((d) => d.dimensionId === dimensionId)?.values ?? [];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={indirectPoolAccountValidator}
          method="post"
          action={action}
          defaultValues={{
            indirectPoolId: poolId,
            role: "Cost",
            accountId: "",
            dimensionId: "",
            dimensionValueId: ""
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Account</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="account-add" />
            <Hidden name="indirectPoolId" />
            <div className="flex flex-col gap-4">
              <Select
                name="role"
                label={t`Role`}
                options={indirectPoolAccountRoles.map((role) => ({
                  label: role === "Cost" ? t`Cost` : t`Base`,
                  value: role
                }))}
                helperText={t`Cost goes into the pool. Base is what the pool's rate applies to.`}
              />
              <Account name="accountId" label={t`Account`} />
              <SelectControlled
                name="dimensionId"
                label={t`Dimension`}
                isOptional
                options={choosable.map((d) => ({
                  label: d.dimensionName,
                  value: d.dimensionId
                }))}
                value={dimensionId}
                onChange={(option) => setDimensionId(option?.value ?? "")}
              />
              {dimensionId && (
                <Select
                  key={dimensionId}
                  name="dimensionValueId"
                  label={t`Value`}
                  options={values.map((v) => ({ label: v.name, value: v.id }))}
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default IndirectPoolAccounts;
