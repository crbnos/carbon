import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Switch,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { getCompanyPrivateBucket } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import { LuFile, LuPaperclip } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import type { ZodSchema } from "zod";
import CustomerAvatar from "~/components/CustomerAvatar";
import FileDropzone from "~/components/FileDropzone";
import {
  Boolean as BooleanInput,
  Customer,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Number as NumberInput,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import { UserSelect } from "~/components/Selectors";
import SupplierAvatar from "~/components/SupplierAvatar";
import { usePermissions, useUser } from "~/hooks";
import { DataType } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import {
  attributeBooleanValidator,
  attributeCustomerValidator,
  attributeFileValidator,
  attributeNumericValidator,
  attributeSupplierValidator,
  attributeTextValidator,
  attributeUserValidator,
  deleteUserAttributeValueValidator
} from "../../account.models";
import type { PublicAttributes } from "../../types";

type UserAttributesFormProps = {
  attributeCategory?: PublicAttributes;
};

const UserAttributesForm = ({ attributeCategory }: UserAttributesFormProps) => {
  const { personId } = useParams();
  const permissions = usePermissions();
  const user = useUser();
  const updateFetcher = useFetcher<{}>();
  const [optimisticUpdates, setOptimisticUpdates] = useState<
    Record<string, boolean | string | number | undefined>
  >({});

  const isAuthorized = !personId;
  if (!isAuthorized && !permissions.can("update", "resources"))
    throw new Error("Unauthorized");

  const userId = isAuthorized ? user.id : personId;

  if (
    !attributeCategory ||
    !attributeCategory.userAttribute ||
    !Array.isArray(attributeCategory.userAttribute) ||
    attributeCategory.userAttribute.length === 0
  )
    return null;

  return (
    <div className="w-full">
      <VStack spacing={4}>
        {attributeCategory.userAttribute.map((attribute) => {
          const genericProps = getGenericProps(
            // @ts-ignore
            attribute as PublicAttributes["userAttribute"],
            optimisticUpdates[attribute.id]
          );

          return (
            <GenericAttributeRow
              key={attribute.id}
              attribute={attribute}
              isAuthorized={isAuthorized}
              setOptimisticUpdate={(
                value: boolean | string | number | undefined
              ) =>
                setOptimisticUpdates((prev) => ({
                  ...prev,
                  [attribute.id]: value
                }))
              }
              // @ts-ignore
              updateFetcher={updateFetcher}
              userId={userId}
              {...genericProps}
            />
          );
        })}
      </VStack>
    </div>
  );
};

type GenericAttributeRowProps = {
  attribute: {
    id: string | null;
    name: string | null;
    canSelfManage: boolean | null;
    listOptions: string[] | null;
  };
  displayValue: string | number | boolean;
  isAuthorized: boolean;
  type: DataType;
  updateFetcher: ReturnType<typeof useFetcher>;
  userAttributeId: string;
  userAttributeValueId?: string;
  userId: string;
  value: Date | string | number | boolean | null;
  setOptimisticUpdate: (value: boolean | string | number | undefined) => void;
};

const GenericAttributeRow = (props: GenericAttributeRowProps) => {
  const editing = useDisclosure();
  const { locale } = useLocale();
  const onSubmit = (value: string | boolean | number) => {
    props.setOptimisticUpdate(value);
    editing.onClose();
  };

  return (
    <div key={props.attribute.id} className="w-full">
      {editing.isOpen
        ? TypedForm({ ...props, onSubmit, onClose: editing.onClose })
        : TypedDisplay({ ...props, locale, onOpen: editing.onOpen })}
    </div>
  );
};

function TypedForm(
  props: GenericAttributeRowProps & {
    onSubmit: (value: string | boolean | number) => void;
    onClose: () => void;
  }
) {
  const {
    attribute,
    type,
    value,
    updateFetcher,
    userAttributeId,
    userAttributeValueId,
    userId,
    onSubmit,
    onClose
  } = props;
  switch (type) {
    case DataType.Boolean:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeBooleanValidator as ZodSchema}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value === true
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="boolean" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <div>
                <BooleanInput name="value" />
              </div>
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">
                <Trans>Save</Trans>
              </Submit>
              <Button variant="ghost" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.Date:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeTextValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="date" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <DatePicker name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.List:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeTextValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="list" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <Select
                name="value"
                options={
                  attribute.listOptions?.map((option) => ({
                    label: option,
                    value: option
                  })) ?? []
                }
              />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.Numeric:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeNumericValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value ? Number(value) : undefined
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="numeric" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <NumberInput name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.Text:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeTextValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="text" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <Input name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.User:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeUserValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="user" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <Employee name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.Customer:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeCustomerValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="customer" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <Customer label="" name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.Supplier:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeSupplierValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString()
          }}
          fetcher={updateFetcher}
          onSubmit={(data) => onSubmit(data.value)}
        >
          <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
            <p className="text-muted-foreground self-center">
              {attribute.name}
            </p>
            <div>
              <Hidden name="type" value="supplier" />
              <Hidden name="userAttributeId" />
              <Hidden name="userAttributeValueId" />
              <Supplier label="" name="value" />
            </div>
            <HStack className="justify-end w-full self-center">
              <Submit type="submit">Save</Submit>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </div>
        </ValidatedForm>
      );
    case DataType.File:
      return (
        <FileAttributeForm
          attribute={attribute}
          userAttributeId={userAttributeId}
          userAttributeValueId={userAttributeValueId}
          value={value}
          updateFetcher={updateFetcher}
          userId={userId}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      );
    default:
      return (
        <div className="text-destructive bg-destructive-foreground p-4 w-full">
          Unknown data type
        </div>
      );
  }
}

function TypedDisplay(
  props: GenericAttributeRowProps & {
    locale: string;
    onOpen: () => void;
  }
) {
  const {
    attribute,
    displayValue,
    isAuthorized,
    locale,
    type,
    userAttributeValueId,
    value,
    onOpen,
    setOptimisticUpdate
  } = props;
  switch (type) {
    case DataType.Boolean:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground items-center">{attribute.name}</p>
          {displayValue === "N/A" ? (
            <p className="self-center">{displayValue}</p>
          ) : (
            <div>
              <Switch disabled checked={displayValue === true} />
            </div>
          )}
          <HStack className="justify-end w-full self-center">
            <Button
              isDisabled={isAuthorized && !attribute.canSelfManage}
              variant="ghost"
              onClick={onOpen}
            >
              Update
            </Button>
          </HStack>
        </div>
      );
    case DataType.Date:
    case DataType.List:
    case DataType.Text:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          <p className="self-center">{displayValue}</p>
          <UpdateRemoveButtons
            canRemove={
              !isAuthorized ||
              (attribute.canSelfManage === true &&
                !!value &&
                !!userAttributeValueId)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
    case DataType.Numeric:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          <p className="self-center">{displayValue.toLocaleString(locale)}</p>
          <UpdateRemoveButtons
            canRemove={
              !isAuthorized || (attribute.canSelfManage === true && !!value)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
    case DataType.User:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          {value ? (
            <UserSelect disabled value={value.toString()} />
          ) : (
            <p className="self-center">{displayValue}</p>
          )}

          <UpdateRemoveButtons
            canRemove={
              !isAuthorized || (attribute.canSelfManage === true && !!value)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
    case DataType.Customer:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          {value ? (
            <CustomerAvatar customerId={value.toString()} />
          ) : (
            <p className="self-center">{displayValue}</p>
          )}

          <UpdateRemoveButtons
            canRemove={
              !isAuthorized || (attribute.canSelfManage === true && !!value)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
    case DataType.Supplier:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          {value ? (
            <SupplierAvatar supplierId={value.toString()} />
          ) : (
            <p className="self-center">{displayValue}</p>
          )}

          <UpdateRemoveButtons
            canRemove={
              !isAuthorized || (attribute.canSelfManage === true && !!value)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
    case DataType.File:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground self-center">{attribute.name}</p>
          {value ? (
            <a
              href={getPrivateUrl(value.toString())}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <LuPaperclip className="size-4" />
              <span className="truncate max-w-[200px]">
                {value.toString().split("/").pop()}
              </span>
            </a>
          ) : (
            <p className="self-center">{displayValue}</p>
          )}

          <UpdateRemoveButtons
            canRemove={
              !isAuthorized || (attribute.canSelfManage === true && !!value)
            }
            canUpdate={!isAuthorized || (attribute.canSelfManage ?? false)}
            {...props}
            onSubmit={setOptimisticUpdate}
          />
        </div>
      );
  }
}

function getGenericProps(
  attribute: NonNullable<PublicAttributes["userAttribute"]>,
  optimisticUpdate: string | boolean | number | undefined
) {
  if (
    !("attributeDataType" in attribute) ||
    !attribute.attributeDataType ||
    Array.isArray(attribute.attributeDataType)
  )
    throw new Error("Missing attributeDataType");

  // @ts-expect-error
  const type = attribute.attributeDataType.id;
  // @ts-expect-error
  const userAttributeId = attribute.id;
  let userAttributeValueId = undefined;

  let displayValue: string | number | boolean = "N/A";
  let value: string | number | boolean | Date | null = null;

  if (
    // @ts-expect-error
    attribute.userAttributeValue &&
    // @ts-expect-error
    Array.isArray(attribute.userAttributeValue) &&
    // @ts-expect-error
    attribute.userAttributeValue.length === 1
  ) {
    // @ts-expect-error
    const userAttributeValue = attribute.userAttributeValue[0];
    userAttributeValueId = userAttributeValue.id;

    switch (type) {
      case DataType.Boolean:
        value = userAttributeValue.valueBoolean;
        displayValue = userAttributeValue.valueBoolean ?? false;
        break;
      case DataType.Date:
        value = userAttributeValue.valueDate;
        if (userAttributeValue.valueDate)
          displayValue = parseDate(userAttributeValue.valueDate).toString();
        break;
      case DataType.List:
        value = userAttributeValue.valueText;
        if (userAttributeValue.valueText)
          displayValue = userAttributeValue.valueText;
        break;
      case DataType.Numeric:
        value = userAttributeValue.valueNumeric;
        if (userAttributeValue.valueNumeric)
          displayValue = Number(userAttributeValue.valueNumeric);
        break;
      case DataType.Text:
        value = userAttributeValue.valueText;
        if (userAttributeValue.valueText)
          displayValue = userAttributeValue.valueText;
        break;
      case DataType.User:
        value = userAttributeValue.valueUser;
        if (userAttributeValue.valueUser)
          displayValue = userAttributeValue.valueUser;
        break;
      case DataType.Customer:
        value = userAttributeValue.valueText;
        if (userAttributeValue.valueText)
          displayValue = userAttributeValue.valueText;
        break;
      case DataType.Supplier:
        value = userAttributeValue.valueText;
        if (userAttributeValue.valueText)
          displayValue = userAttributeValue.valueText;
        break;
      case DataType.File:
        value = userAttributeValue.valueFile;
        if (userAttributeValue.valueFile)
          displayValue = userAttributeValue.valueFile;
    }
  }

  if (optimisticUpdate !== undefined) {
    displayValue = optimisticUpdate;
    value = optimisticUpdate;
  }

  return {
    displayValue,
    type,
    userAttributeId,
    userAttributeValueId,
    value
  };
}

function FileAttributeForm({
  attribute,
  userAttributeId,
  userAttributeValueId,
  value,
  updateFetcher,
  userId,
  onSubmit,
  onClose
}: {
  attribute: {
    id: string | null;
    name: string | null;
    canSelfManage: boolean | null;
    listOptions: string[] | null;
  };
  userAttributeId: string;
  userAttributeValueId?: string;
  value: Date | string | number | boolean | null;
  updateFetcher: ReturnType<typeof useFetcher>;
  userId: string;
  onSubmit: (value: string | boolean | number) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(
    value?.toString() ?? null
  );

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles[0] || !carbon) return;
    const fileUpload = acceptedFiles[0];

    setFile(fileUpload);
    toast.info(t`Uploading ${fileUpload.name}`);

    const fileName = `${company.id}/person/${userId}/${fileUpload.name}`;

    const upload = await carbon?.storage
      .from(getCompanyPrivateBucket(company.id))
      .upload(fileName, fileUpload, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true
      });

    if (upload.error) {
      toast.error(t`Failed to upload file: ${fileUpload.name}`);
    } else if (upload.data?.path) {
      toast.success(t`Uploaded: ${fileUpload.name}`);
      setFilePath(upload.data.path);
    }
  };

  return (
    <ValidatedForm
      method="post"
      action={path.to.userAttribute(userId)}
      validator={attributeFileValidator}
      defaultValues={{
        userAttributeId,
        userAttributeValueId,
        value: filePath ?? ""
      }}
      fetcher={updateFetcher}
      onSubmit={() => {
        if (filePath) onSubmit(filePath);
      }}
    >
      <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
        <p className="text-muted-foreground self-center">{attribute.name}</p>
        <div>
          <Hidden name="type" value="file" />
          <Hidden name="userAttributeId" />
          <Hidden name="userAttributeValueId" />
          <Hidden name="value" value={filePath ?? ""} />
          {file || filePath ? (
            <div className="flex flex-col gap-2 items-center justify-center py-4 w-full">
              <LuFile className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                {file?.name ?? filePath?.split("/").pop()}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFile(null);
                  setFilePath(null);
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <FileDropzone onDrop={onDrop} />
          )}
        </div>
        <HStack className="justify-end w-full self-center">
          <Submit type="submit" isDisabled={!filePath}>
            <Trans>Save</Trans>
          </Submit>
          <Button variant="ghost" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
        </HStack>
      </div>
    </ValidatedForm>
  );
}

function UpdateRemoveButtons({
  canRemove,
  canUpdate,
  updateFetcher,
  userId,
  userAttributeId,
  userAttributeValueId,
  onOpen,
  onSubmit
}: {
  canRemove: boolean;
  canUpdate: boolean;
  updateFetcher: ReturnType<typeof useFetcher>;
  userId: string;
  userAttributeId: string;
  userAttributeValueId?: string;
  onOpen: () => void;
  onSubmit: (value: string | boolean | number | undefined) => void;
}) {
  return (
    <HStack className="justify-end w-full self-center">
      {userAttributeValueId && (
        <ValidatedForm
          method="post"
          action={path.to.deleteUserAttribute(userId)}
          validator={deleteUserAttributeValueValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId
          }}
          fetcher={updateFetcher}
          onSubmit={() => onSubmit(undefined)}
        >
          <Hidden name="userAttributeId" />
          <Hidden name="userAttributeValueId" />
          <Button isDisabled={!canRemove} variant="ghost" type="submit">
            <Trans>Remove</Trans>
          </Button>
        </ValidatedForm>
      )}

      <Button isDisabled={!canUpdate} variant="ghost" onClick={onOpen}>
        Update
      </Button>
    </HStack>
  );
}

export default UserAttributesForm;
