// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuTicketX, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DocumentHeader } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Number,
  Select,
  SequenceOrCustomId,
  Submit,
  Supplier,
  TextArea
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import {
  isMemoLocked,
  memoDirection,
  memoValidator
} from "~/modules/invoicing";
import { path } from "~/utils/path";
import MemoStatus from "./MemoStatus";

type MemoFormValues = z.infer<typeof memoValidator>;

// The one memo document is presented as two forms. `type` fixes the PARTY — and
// only the party — which is also what each list route filters on:
//   creditMemo     → customer
//   supplierCredit → supplier
// Direction stays a user choice. It briefly did not: deriving it from the party
// and force-submitting it rewrote a stored direction on every save and made two
// of the four legal combinations unauthorable. See the Select below.
export type MemoType = "creditMemo" | "supplierCredit";

type MemoFormProps = {
  initialValues: MemoFormValues & { status?: string };
  type: MemoType;
};

const MemoForm = ({ initialValues, type }: MemoFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(
    company?.baseCurrencyCode ?? "USD"
  );
  const permissions = usePermissions();
  const post = useFetcher();
  const isEditing = Boolean(initialValues.id);
  const status = initialValues.status as
    | "Draft"
    | "Posted"
    | "Voided"
    | undefined;
  const isLocked = isMemoLocked(initialValues.status);
  const canMutate = permissions.can("update", "invoicing");
  const canDelete = permissions.can("delete", "invoicing");
  const deleteModal = useDisclosure();
  const voidModal = useDisclosure();

  const isVendor = type === "supplierCredit";
  const typeLabel = isVendor ? t`Supplier Credit` : t`Credit Memo`;

  // `type` decides the PARTY (and therefore which list this memo appears in and
  // which selector is shown) — never the direction. All four party×direction
  // combinations are legal: `memoDirection` has both values, `memo`'s only party
  // constraint is customer-XOR-supplier, both list routes filter on the party and
  // offer direction as a FILTER, and the dataset validator requires coverage of
  // both. Deriving `direction` from the party and force-submitting it via
  // `<Hidden value>` overwrote the stored value on any save (`Hidden` prefers
  // `value` over `defaultValue`), so editing a customer Debit memo's reference
  // silently flipped it to Credit and posting then booked the opposite journal —
  // and it made two of the four combinations unauthorable.
  const directionOptions = memoDirection.map((d) => ({
    label: <Enumerable value={d} />,
    value: d
  }));

  return (
    <>
      <ValidatedForm
        method="post"
        validator={memoValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
        className="w-full"
      >
        <Card>
          {isEditing ? (
            <DocumentHeader
              title={initialValues.memoId ?? ""}
              status={
                <>
                  <Enumerable value={typeLabel} />
                  <MemoStatus status={status} />
                </>
              }
              menuItems={
                status === "Draft" && canDelete ? (
                  <DropdownMenuItem
                    shortcut={MENU_ITEM_SHORTCUTS.delete}
                    destructive
                    onClick={deleteModal.onOpen}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete</Trans>
                  </DropdownMenuItem>
                ) : undefined
              }
              actions={
                status === "Draft" ? (
                  <Button
                    leftIcon={<LuCheckCheck />}
                    variant="primary"
                    isLoading={post.state !== "idle"}
                    isDisabled={!canMutate}
                    onClick={() =>
                      post.submit(null, {
                        method: "post",
                        action: path.to.memoPost(initialValues.id!)
                      })
                    }
                  >
                    <Trans>Post</Trans>
                  </Button>
                ) : status === "Posted" ? (
                  <Button
                    leftIcon={<LuTicketX />}
                    variant="destructive"
                    type="button"
                    isDisabled={!canMutate}
                    onClick={voidModal.onOpen}
                  >
                    <Trans>Void</Trans>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <CardHeader>
              <CardTitle>
                {isVendor ? (
                  <Trans>New Supplier Credit</Trans>
                ) : (
                  <Trans>New Credit Memo</Trans>
                )}
              </CardTitle>
              <CardDescription>
                {isVendor ? (
                  <Trans>
                    Record a credit from a supplier — it reduces what you owe
                    them. Applications to specific invoices are added after it
                    is created.
                  </Trans>
                ) : (
                  <Trans>
                    Record a credit memo for a customer — it reduces what they
                    owe. Applications to specific invoices are added after it is
                    created.
                  </Trans>
                )}
              </CardDescription>
            </CardHeader>
          )}
          <CardContent>
            <Hidden name="id" />
            {isEditing && <Hidden name="memoId" />}
            <VStack>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                {!isEditing && (
                  <SequenceOrCustomId
                    name="memoId"
                    label={t`Memo ID`}
                    table="memo"
                  />
                )}
                {isVendor ? (
                  <Supplier
                    autoFocus={!isEditing}
                    name="supplierId"
                    label={t`Supplier`}
                  />
                ) : (
                  <Customer
                    autoFocus={!isEditing}
                    name="customerId"
                    label={t`Customer`}
                  />
                )}
                <Select
                  name="direction"
                  label={t`Direction`}
                  options={directionOptions}
                />
                <DatePicker name="memoDate" label={t`Memo Date`} />
                <Currency name="currencyCode" label={t`Currency`} />
                <Number
                  name="exchangeRate"
                  label={t`Exchange Rate`}
                  step={INPUT_STEP.exchangeRate}
                  formatOptions={INPUT_FORMAT.exchangeRate}
                />
                <Number
                  name="amount"
                  label={t`Amount`}
                  formatOptions={INPUT_FORMAT.money(
                    company?.baseCurrencyCode ?? "USD",
                    currencyDecimals
                  )}
                />
                <Input name="reference" label={t`Reference`} />
                <CustomFormFields table="memo" />
              </div>
              <div className="mt-4 w-full">
                <TextArea name="notes" label={t`Notes`} />
              </div>
            </VStack>
          </CardContent>
          <CardFooter>
            <Submit
              isDisabled={
                isEditing
                  ? isLocked || !canMutate
                  : !permissions.can("create", "invoicing")
              }
            >
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>
      {voidModal.isOpen && (
        <ConfirmDelete
          action={path.to.memoVoid(initialValues.id!)}
          name={initialValues.memoId ?? ""}
          title={t`Void ${initialValues.memoId}`}
          text={t`Are you sure you want to void this memo? This will reverse its accounting entries and applications. This cannot be undone.`}
          deleteText={t`Void`}
          onCancel={voidModal.onClose}
          onSubmit={voidModal.onClose}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.memoDelete(initialValues.id!)}
          isOpen={deleteModal.isOpen}
          name={initialValues.memoId ?? ""}
          text={t`Are you sure you want to delete ${initialValues.memoId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default MemoForm;
