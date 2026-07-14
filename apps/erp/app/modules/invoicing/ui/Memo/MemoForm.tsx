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
  FormControl,
  FormLabel,
  Select as PartySelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
import { usePermissions, useUser } from "~/hooks";
import {
  isMemoLocked,
  memoDirection,
  memoValidator
} from "~/modules/invoicing";
import { path } from "~/utils/path";
import MemoStatus from "./MemoStatus";

type MemoFormValues = z.infer<typeof memoValidator>;

type MemoFormProps = {
  initialValues: MemoFormValues & { status?: string };
};

const MemoForm = ({ initialValues }: MemoFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const permissions = usePermissions();
  const post = useFetcher();
  const voidFetcher = useFetcher();
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

  // Party type is a UI-only toggle — NOT a validator field. It switches which of
  // customerId/supplierId is shown; the hidden one stays empty. A memo can be for
  // a customer OR a supplier in either direction (all four combos are valid), so
  // this is independent of the direction control below. When editing, derive the
  // initial value from whichever party id is set.
  const [partyType, setPartyType] = useState<"Customer" | "Supplier">(
    initialValues.supplierId ? "Supplier" : "Customer"
  );

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
                  <Enumerable value={initialValues.direction} />
                  <MemoStatus status={status} />
                </>
              }
              menuItems={
                status === "Draft" && canDelete ? (
                  <DropdownMenuItem destructive onClick={deleteModal.onOpen}>
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
                    isLoading={voidFetcher.state !== "idle"}
                    isDisabled={!canMutate}
                    onClick={() =>
                      voidFetcher.submit(null, {
                        method: "post",
                        action: path.to.memoVoid(initialValues.id!)
                      })
                    }
                  >
                    <Trans>Void</Trans>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <CardHeader>
              <CardTitle>
                <Trans>New Credit / Debit Memo</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Record a credit or debit memo against a customer or supplier.
                  Applications to specific invoices are added after the memo is
                  created.
                </Trans>
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
                <Select
                  name="direction"
                  label={t`Direction`}
                  options={directionOptions}
                />
                {/* UI-only party-type select; no validator field. It only
                    controls which of customerId/supplierId is shown. */}
                <FormControl>
                  <FormLabel>
                    <Trans>Party Type</Trans>
                  </FormLabel>
                  <PartySelect
                    value={partyType}
                    onValueChange={(value) => {
                      if (value === "Customer" || value === "Supplier") {
                        setPartyType(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Customer">
                        <Enumerable value="Customer" />
                      </SelectItem>
                      <SelectItem value="Supplier">
                        <Enumerable value="Supplier" />
                      </SelectItem>
                    </SelectContent>
                  </PartySelect>
                </FormControl>
                {partyType === "Customer" ? (
                  <Customer name="customerId" label={t`Customer`} />
                ) : (
                  <Supplier name="supplierId" label={t`Supplier`} />
                )}
                <DatePicker name="memoDate" label={t`Memo Date`} />
                <Currency name="currencyCode" label={t`Currency`} />
                <Number
                  name="exchangeRate"
                  label={t`Exchange Rate`}
                  formatOptions={{
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4
                  }}
                />
                <Number
                  name="amount"
                  label={t`Amount`}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
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
