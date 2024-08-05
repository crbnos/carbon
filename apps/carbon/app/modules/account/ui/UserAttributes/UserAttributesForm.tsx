import { Button, HStack, Switch, VStack, useDisclosure } from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { parseDate } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { useFetcher, useParams } from "@remix-run/react";
import { useState } from "react";
import type { ZodSchema } from "zod";
import {
  Boolean as BooleanInput,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Number as NumberInput,
  Select,
  Submit,
} from "~/components/Form";
import { UserSelect } from "~/components/Selectors";
import { usePermissions, useUser } from "~/hooks";
import type { PublicAttributes } from "~/modules/account";
import {
  attributeBooleanValidator,
  attributeNumericValidator,
  attributeTextValidator,
  attributeUserValidator,
  deleteUserAttributeValueValidator,
} from "~/modules/account";
import { DataType } from "~/modules/shared";
import { path } from "~/utils/path";

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
                  [attribute.id]: value,
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
  const onSubmit = (value: string | boolean | number) => {
    props.setOptimisticUpdate(value);
    editing.onClose();
  };

  return (
    <div key={props.attribute.id} className="w-full">
      {editing.isOpen
        ? TypedForm({ ...props, onSubmit, onClose: editing.onClose })
        : TypedDisplay({ ...props, onOpen: editing.onOpen })}
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
    onClose,
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
            value: value === true,
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
              <BooleanInput name="value" />
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
    case DataType.Date:
      return (
        <ValidatedForm
          method="post"
          action={path.to.userAttribute(userId)}
          validator={attributeTextValidator}
          defaultValues={{
            userAttributeId,
            userAttributeValueId,
            value: value?.toString(),
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
            value: value?.toString(),
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
                    value: option,
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
            value: value ? Number(value) : undefined,
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
            value: value?.toString(),
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
            value: value?.toString(),
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
    onOpen: () => void;
  }
) {
  const { locale } = useLocale();
  const {
    attribute,
    displayValue,
    isAuthorized,
    type,
    userAttributeValueId,
    value,
    onOpen,
    setOptimisticUpdate,
  } = props;
  switch (type) {
    case DataType.Boolean:
      return (
        <div className="grid grid-cols-[1fr_2fr_1fr] border-t border-border gap-x-2 pt-3 w-full items-center">
          <p className="text-muted-foreground items-center">{attribute.name}</p>
          {displayValue === "N/A" ? (
            <p className="self-center">{displayValue}</p>
          ) : (
            <Switch disabled checked={displayValue === true} />
          )}
          <HStack className="justify-end w-full self-center">
            <Button
              isDisabled={!isAuthorized || !attribute.canSelfManage}
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

  const type = attribute.attributeDataType.id;
  const userAttributeId = attribute.id;
  let userAttributeValueId = undefined;

  let displayValue: string | number | boolean = "N/A";
  let value: string | number | boolean | Date | null = null;

  if (
    attribute.userAttributeValue &&
    Array.isArray(attribute.userAttributeValue) &&
    attribute.userAttributeValue.length === 1
  ) {
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
    value,
  };
}

function UpdateRemoveButtons({
  canRemove,
  canUpdate,
  updateFetcher,
  userId,
  userAttributeId,
  userAttributeValueId,
  onOpen,
  onSubmit,
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
            userAttributeValueId,
          }}
          fetcher={updateFetcher}
          onSubmit={() => onSubmit(undefined)}
        >
          <Hidden name="userAttributeId" />
          <Hidden name="userAttributeValueId" />
          <Button isDisabled={!canRemove} variant="ghost" type="submit">
            Remove
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
