import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Array,
  Hidden,
  Input,
  Select,
  Submit,
  ValidatedForm,
  validationError,
  validator,
} from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { Await, useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  LuGripVertical,
  LuHash,
  LuKeySquare,
  LuList,
  LuMoreVertical,
  LuPlusCircle,
  LuToggleLeft,
  LuType,
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { useRouteData } from "~/hooks";
import type {
  ConfigurationParameter,
  MakeMethod,
  Material,
  MethodOperation,
} from "~/modules/items";
import {
  configurationParameterDataTypes,
  configurationParameterValidator,
  getConfigurationParameters,
  getItemManufacturing,
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  MakeMethodTools,
} from "~/modules/items/ui/Item";
import { PartManufacturingForm } from "~/modules/items/ui/Parts";
import type { action as configurationParameterAction } from "~/routes/x+/part+/$itemId.parameter";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

import { formatRelativeTime } from "@carbon/utils";
import { ConfirmDelete } from "~/components/Modals";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partManufacturing] = await Promise.all([
    getItemManufacturing(client, itemId, companyId),
  ]);

  if (partManufacturing.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(partManufacturing.error, "Failed to load part manufacturing")
      )
    );
  }

  return defer({
    partManufacturing: partManufacturing.data,
    configurationParameters: partManufacturing.data.requiresConfiguration
      ? getConfigurationParameters(client, itemId, companyId)
      : Promise.resolve({ data: [], error: null }),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(partManufacturingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartManufacturing = await upsertItemManufacturing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePartManufacturing.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(
          updatePartManufacturing.error,
          "Failed to update part manufacturing"
        )
      )
    );
  }

  throw redirect(
    path.to.partManufacturing(itemId),
    await flash(request, success("Updated part manufacturing"))
  );
}

export default function MakeMethodRoute() {
  const { partManufacturing, configurationParameters } =
    useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.partManufacturing(itemId));

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...partManufacturing,
    lotSize: partManufacturing.lotSize ?? 0,
    ...getCustomFields(partManufacturing.customFields),
  };

  return (
    <VStack spacing={2} className="p-2">
      <MakeMethodTools itemId={itemId} type="Part" />
      <PartManufacturingForm
        key={itemId}
        initialValues={manufacturingInitialValues}
      />
      {partManufacturing.requiresConfiguration && (
        <Suspense
          fallback={
            <Card>
              <CardHeader>
                <CardTitle>Options</CardTitle>
              </CardHeader>
              <CardContent className="min-h-[200px]"></CardContent>
            </Card>
          }
        >
          <Await resolve={configurationParameters}>
            {(resolvedOptions) => (
              <ConfigurationParametersForm
                key={`options:${itemId}`}
                options={resolvedOptions.data ?? []}
              />
            )}
          </Await>
        </Suspense>
      )}

      <BillOfProcess
        key={`bop:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations ?? []}
      />
      <BillOfMaterial
        key={`bom:${itemId}`}
        makeMethodId={makeMethodId}
        // @ts-ignore
        materials={manufacturingRouteData?.methodMaterials ?? []}
        // @ts-ignore
        operations={manufacturingRouteData?.methodOperations}
      />
    </VStack>
  );
}

function useConfigurationParameters(option?: ConfigurationParameter) {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const [key, setKey] = useState(option?.key ?? "");
  const [isList, setIsList] = useState(option?.dataType === "list");

  const onChangeCheckForListType = (
    newValue: {
      value: string;
      label: string | JSX.Element;
    } | null
  ) => {
    if (!newValue) return;
    const type = newValue.value;
    setIsList(type === "list");
  };

  const updateKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    const label = e.target.value;
    setKey(label.toLowerCase().replace(/ /g, "_"));
  };

  return {
    key,
    isList,
    itemId,
    onChangeCheckForListType,
    setKey,
    setIsList,
    updateKey,
  };
}

function ConfigurationParametersForm({
  options,
}: {
  options: ConfigurationParameter[];
}) {
  const {
    isList,
    itemId,
    key,
    onChangeCheckForListType,
    setKey,
    setIsList,
    updateKey,
  } = useConfigurationParameters();

  const fetcher = useFetcher<typeof configurationParameterAction>();
  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error("Failed to update configuration option");
    }
  }, [fetcher.data]);
  return (
    <Card isCollapsible>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          <div className="p-6 border rounded-lg">
            <ValidatedForm
              action={path.to.configurationParameter(itemId)}
              method="post"
              validator={configurationParameterValidator}
              fetcher={fetcher}
              resetAfterSubmit
              onSubmit={() => {
                setKey("");
                setIsList(false);
              }}
              defaultValues={{
                itemId: itemId,
                key: "",
                label: "",
                dataType: "numeric",
                listOptions: [],
                configurationParameterGroupId: undefined,
              }}
              className="w-full"
            >
              <Hidden name="id" />
              <Hidden name="itemId" />
              <Hidden name="key" value={key} />
              <VStack spacing={4}>
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <VStack>
                    <Input name="label" label="Label" onChange={updateKey} />
                    {key && (
                      <HStack spacing={1}>
                        <LuKeySquare className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {key}
                        </span>
                      </HStack>
                    )}
                  </VStack>

                  <Select
                    name="dataType"
                    label="Data Type"
                    options={configurationParameterDataTypes.map((type) => ({
                      label: (
                        <HStack className="w-full">
                          <ConfigurationParameterDataTypeIcon
                            type={type}
                            className="mr-2"
                          />
                          {capitalize(type)}
                        </HStack>
                      ),
                      value: type,
                    }))}
                    onChange={onChangeCheckForListType}
                  />
                  {isList && <Array name="listOptions" label="List Options" />}
                </div>

                <Submit
                  leftIcon={<LuPlusCircle />}
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={fetcher.state !== "idle"}
                >
                  Add Option
                </Submit>
              </VStack>
            </ValidatedForm>
          </div>

          {options.length > 0 && (
            <div className="border rounded-lg">
              {options.map((option, index) => (
                <ConfigurableOption
                  key={option.id}
                  option={option}
                  className={index === options.length - 1 ? "border-none" : ""}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigurableOption({
  option,
  className,
}: {
  option: ConfigurationParameter;
  className?: string;
}) {
  const { isList, key, onChangeCheckForListType, updateKey } =
    useConfigurationParameters(option);

  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof configurationParameterAction>();

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  const isUpdated = option.updatedBy !== null;
  const person = isUpdated ? option.updatedBy : option.createdBy;
  const date = option.updatedAt ?? option.createdAt;

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.configurationParameter(option.itemId)}
          method="post"
          validator={configurationParameterValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: option.id,
            itemId: option.itemId,
            key: option.key,
            label: option.label,
            dataType: option.dataType,
            listOptions: option.listOptions ?? [],
          }}
        >
          <Hidden name="id" />
          <Hidden name="itemId" />
          <Hidden name="key" value={key} />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <VStack>
                <Input
                  name="label"
                  label="Label"
                  onChange={updateKey}
                  autoFocus
                />
                {key && (
                  <HStack spacing={1}>
                    <LuKeySquare className="w-3 h-3 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{key}</span>
                  </HStack>
                )}
              </VStack>

              <Select
                name="dataType"
                label="Data Type"
                options={configurationParameterDataTypes.map((type) => ({
                  label: (
                    <HStack className="w-full">
                      <ConfigurationParameterDataTypeIcon
                        type={type}
                        className="mr-2"
                      />
                      {capitalize(type)}
                    </HStack>
                  ),
                  value: type,
                }))}
                onChange={onChangeCheckForListType}
              />
              {isList && <Array name="listOptions" label="List Options" />}
            </div>
            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={2} className="w-1/2">
            <IconButton
              aria-label="Reorder"
              icon={<LuGripVertical />}
              variant="ghost"
            />
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <ConfigurationParameterDataTypeIcon
                  type={option.dataType}
                  className="w-4 h-4"
                />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.key}
                </span>
              </VStack>
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              <span className="text-xs text-muted-foreground">
                {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
              </span>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Open menu"
                  icon={<LuMoreVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onClick={deleteModalDisclosure.onOpen}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteConfigurationParameter(
            option.itemId,
            option.id
          )}
          isOpen={deleteModalDisclosure.isOpen}
          name={option.label}
          text={`Are you sure you want to delete the ${option.label} parameter? This will not update any formulas that are using this parameter.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function ConfigurationParameterDataTypeIcon({
  type,
  className,
}: {
  type: (typeof configurationParameterDataTypes)[number];
  className?: string;
}) {
  switch (type) {
    case "numeric":
      return <LuHash className={cn("w-4 h-4 text-blue-600", className)} />;
    case "text":
      return <LuType className={cn("w-4 h-4 text-green-600", className)} />;
    case "boolean":
      return (
        <LuToggleLeft className={cn("w-4 h-4 text-purple-600", className)} />
      );
    case "list":
      return <LuList className={cn("w-4 h-4 text-orange-600", className)} />;
    default:
      return null;
  }
}
