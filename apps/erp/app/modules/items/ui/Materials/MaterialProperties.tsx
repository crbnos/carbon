import type { Json } from "@carbon/database";
import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
  toast,
  useDisclosure,
} from "@carbon/react";
import { Await, useFetcher, useParams } from "@remix-run/react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { LuCopy, LuKeySquare, LuLink, LuTriangleAlert } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import { Boolean, Tags, UnitOfMeasure } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import MaterialDimension from "~/components/Form/MaterialDimension";
import MaterialFinish from "~/components/Form/MaterialFinish";
import MaterialGrade from "~/components/Form/MaterialGrade";
import MaterialType from "~/components/Form/MaterialType";
import Shape from "~/components/Form/Shape";
import Substance from "~/components/Form/Substance";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { itemTrackingTypes } from "../../items.models";
import type {
  ItemFile,
  MaterialSummary,
  PickMethod,
  SupplierPart,
} from "../../types";
import { FileBadge } from "../Item";

const MaterialProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const [substanceId, setSubstanceId] = useState<string | undefined>();
  const [formId, setFormId] = useState<string | undefined>();

  const sharedMaterialsData = useRouteData<{ locations: ListItem[] }>(
    path.to.materialRoot
  );
  const routeData = useRouteData<{
    materialSummary: MaterialSummary;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    tags: { name: string }[];
  }>(path.to.material(itemId));

  const locations = sharedMaterialsData?.locations ?? [];
  const supplierParts = routeData?.supplierParts ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.materialSummary?.assignee;

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const confirmDisclosure = useDisclosure();
  const [materialPropertyUpdate, setMaterialPropertyUpdate] = useState<{
    field:
      | "materialFormId"
      | "materialSubstanceId"
      | "gradeId"
      | "dimensionId"
      | "finishId"
      | "materialTypeId";
    value: string | null;
  } | null>(null);

  const settings = useSettings();

  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "active"
        | "unitOfMeasureCode"
        | "materialFormId"
        | "materialSubstanceId"
        | "gradeId"
        | "dimensionId"
        | "finishId"
        | "materialTypeId",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("items", itemId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId]
  );

  const handleUpdate = useCallback(
    (
      field:
        | "name"
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "active"
        | "unitOfMeasureCode"
        | "materialFormId"
        | "materialSubstanceId"
        | "gradeId"
        | "dimensionId"
        | "finishId"
        | "materialTypeId",
      value: string | null
    ) => {
      console.log(settings.materialGeneratedIds);
      console.log(field);
      if (
        settings.materialGeneratedIds &&
        [
          "materialSubstanceId",
          "materialFormId",
          "dimensionId",
          "finishId",
          "materialTypeId",
          "gradeId",
        ].includes(field)
      ) {
        console.log("ok");
        setMaterialPropertyUpdate({
          // @ts-ignore
          field,
          value,
        });
        confirmDisclosure.onOpen();
        return;
      }

      onUpdate(field, value);
    },
    [confirmDisclosure, onUpdate, settings.materialGeneratedIds]
  );

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", routeData?.materialSummary?.readableId ?? "");
      formData.append("table", "material");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.materialSummary?.readableId]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.materialSummary?.readableId ?? "");
      formData.append("table", "material");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.materialSummary?.readableId]
  );

  const [suppliers] = useSuppliers();

  // Initialize state with current material data
  useEffect(() => {
    if (routeData?.materialSummary) {
      setSubstanceId(
        routeData.materialSummary.materialSubstanceId ?? undefined
      );
      setFormId(routeData.materialSummary.materialFormId ?? undefined);
    }
  }, [routeData?.materialSummary]);

  return (
    <>
      <VStack
        spacing={4}
        className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
      >
        <VStack spacing={2}>
          <HStack className="w-full justify-between">
            <h3 className="text-xs text-muted-foreground">Properties</h3>
            <HStack spacing={1}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label="Link"
                    size="sm"
                    className="p-1"
                    onClick={() =>
                      copyToClipboard(
                        window.location.origin + path.to.material(itemId)
                      )
                    }
                  >
                    <LuLink className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <span>Copy link to material</span>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label="Copy"
                    size="sm"
                    className="p-1"
                    onClick={() =>
                      copyToClipboard(routeData?.materialSummary?.id ?? "")
                    }
                  >
                    <LuKeySquare className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <span>Copy material unique identifier</span>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label="Copy"
                    size="sm"
                    className="p-1"
                    onClick={() =>
                      copyToClipboard(routeData?.materialSummary?.id ?? "")
                    }
                  >
                    <LuCopy className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <span>Copy material number</span>
                </TooltipContent>
              </Tooltip>
            </HStack>
          </HStack>
          <VStack spacing={0}>
            <span className="text-sm tracking-tight">
              {routeData?.materialSummary?.readableIdWithRevision}
            </span>
            <ValidatedForm
              defaultValues={{
                name: routeData?.materialSummary?.name ?? undefined,
              }}
              validator={z.object({
                name: z.string(),
              })}
              className="w-full -mt-2"
            >
              <span className="text-xs text-muted-foreground">
                <InputControlled
                  label=""
                  name="name"
                  inline
                  size="sm"
                  value={routeData?.materialSummary?.name ?? ""}
                  onBlur={(e) => {
                    onUpdate("name", e.target.value ?? null);
                  }}
                  className="text-muted-foreground"
                />
              </span>
            </ValidatedForm>
          </VStack>
          <ItemThumbnailUpload
            path={routeData?.materialSummary?.thumbnailPath}
            itemId={itemId}
          />
        </VStack>
        {/* <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={itemId}
          table="item"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "parts")}
        />
      </VStack> */}

        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">Tracking Type</h3>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Badge variant="secondary">
                <TrackingTypeIcon
                  type={routeData?.materialSummary?.itemTrackingType!}
                  className={cn(
                    "mr-2",
                    routeData?.materialSummary?.active === false && "opacity-50"
                  )}
                />
                <span>{routeData?.materialSummary?.itemTrackingType!}</span>
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {itemTrackingTypes.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onUpdate("itemTrackingType", type)}
                >
                  <DropdownMenuIcon icon={<TrackingTypeIcon type={type} />} />
                  <span>{type}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </VStack>

        <VStack spacing={2}>
          <h3 className="text-xs text-muted-foreground">Default Method Type</h3>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Badge variant="secondary">
                <MethodIcon
                  type={routeData?.materialSummary?.defaultMethodType!}
                  className={cn(
                    "mr-2",
                    routeData?.materialSummary?.active === false && "opacity-50"
                  )}
                />
                <span>{routeData?.materialSummary?.defaultMethodType!}</span>
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {methodType
                .filter((type) => type !== "Make")
                .map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => onUpdate("defaultMethodType", type)}
                  >
                    <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                    <span>{type}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </VStack>

        <ValidatedForm
          defaultValues={{
            materialFormId:
              routeData?.materialSummary?.materialFormId ?? undefined,
          }}
          validator={z.object({
            materialFormId: z.string().nullable(),
          })}
          className="w-full"
        >
          <Shape
            label="Shape"
            name="materialFormId"
            inline
            onChange={(value) => {
              handleUpdate("materialFormId", value?.value ?? null);
            }}
          />
        </ValidatedForm>

        <ValidatedForm
          defaultValues={{
            materialSubstanceId:
              routeData?.materialSummary?.materialSubstanceId ?? undefined,
          }}
          validator={z.object({
            materialSubstanceId: z.string().nullable(),
          })}
          className="w-full"
        >
          <Substance
            label="Substance"
            name="materialSubstanceId"
            inline
            onChange={(value) => {
              handleUpdate("materialSubstanceId", value?.value ?? null);
            }}
          />
        </ValidatedForm>

        <ValidatedForm
          defaultValues={{
            gradeId: routeData?.materialSummary?.gradeId ?? undefined,
          }}
          validator={z.object({
            gradeId: zfd.text(z.string().optional()),
          })}
          className="w-full"
        >
          <MaterialGrade
            label="Grade"
            name="gradeId"
            substanceId={substanceId}
            inline
            onChange={(value) => {
              handleUpdate("gradeId", value?.id ?? null);
            }}
          />
        </ValidatedForm>

        <ValidatedForm
          defaultValues={{
            dimensionId: routeData?.materialSummary?.dimensionId ?? undefined,
          }}
          validator={z.object({
            dimensionId: zfd.text(z.string().optional()),
          })}
          className="w-full"
        >
          <MaterialDimension
            label="Dimensions"
            name="dimensionId"
            formId={formId}
            inline
            onChange={(value) => {
              handleUpdate("dimensionId", value?.id ?? null);
            }}
          />
        </ValidatedForm>

        <ValidatedForm
          defaultValues={{
            finishId: routeData?.materialSummary?.finishId ?? undefined,
          }}
          validator={z.object({
            finishId: zfd.text(z.string().optional()),
          })}
          className="w-full"
        >
          <MaterialFinish
            label="Finish"
            name="finishId"
            substanceId={substanceId}
            inline
            onChange={(value) => {
              handleUpdate("finishId", value?.id ?? null);
            }}
          />
        </ValidatedForm>

        {substanceId && formId && (
          <ValidatedForm
            defaultValues={{
              materialTypeId:
                routeData?.materialSummary?.materialTypeId ?? undefined,
            }}
            validator={z.object({
              materialTypeId: zfd.text(z.string().optional()),
            })}
            className="w-full"
          >
            <MaterialType
              label="Type"
              name="materialTypeId"
              substanceId={substanceId}
              formId={formId}
              inline
              onChange={(value) => {
                handleUpdate("materialTypeId", value?.value ?? null);
              }}
            />
          </ValidatedForm>
        )}

        <ValidatedForm
          defaultValues={{
            unitOfMeasureCode:
              routeData?.materialSummary?.unitOfMeasureCode ?? undefined,
          }}
          validator={z.object({
            unitOfMeasureCode: z
              .string()
              .min(1, { message: "Unit of Measure is required" }),
          })}
          className="w-full"
        >
          <UnitOfMeasure
            label="Unit of Measure"
            name="unitOfMeasureCode"
            inline
            onChange={(value) => {
              onUpdate("unitOfMeasureCode", value?.value ?? null);
            }}
          />
        </ValidatedForm>

        <VStack spacing={2}>
          <HStack className="w-full justify-between">
            <h3 className="text-xs text-muted-foreground">Methods</h3>
          </HStack>

          {routeData?.materialSummary?.replenishmentSystem?.includes("Buy") &&
            supplierParts.map((method) => (
              <MethodBadge
                key={method.id}
                type="Buy"
                text={
                  suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
                }
                to={path.to.partPurchasing(itemId)}
              />
            ))}
          {pickMethods.map((method) => (
            <MethodBadge
              key={method.locationId}
              type="Pick"
              text={
                locations.find((l) => l.id === method.locationId)?.name ?? ""
              }
              to={path.to.partInventoryLocation(itemId, method.locationId)}
            />
          ))}
        </VStack>
        <ValidatedForm
          defaultValues={{
            active: routeData?.materialSummary?.active ?? undefined,
          }}
          validator={z.object({
            active: zfd.checkbox(),
          })}
          className="w-full"
        >
          <Boolean
            label="Active"
            name="active"
            variant="small"
            onChange={(value) => {
              onUpdate("active", value ? "on" : "off");
            }}
          />
        </ValidatedForm>
        <ValidatedForm
          defaultValues={{
            tags: routeData?.materialSummary?.tags ?? [],
          }}
          validator={z.object({
            tags: z.array(z.string()).optional(),
          })}
          className="w-full"
        >
          <Tags
            label="Tags"
            name="tags"
            availableTags={routeData?.tags ?? []}
            table="material"
            inline
            onChange={onUpdateTags}
          />
        </ValidatedForm>

        <CustomFormInlineFields
          customFields={
            (routeData?.materialSummary?.customFields ?? {}) as Record<
              string,
              Json
            >
          }
          table="material"
          tags={routeData?.materialSummary?.tags ?? []}
          onUpdate={onUpdateCustomFields}
        />

        <VStack spacing={2}>
          <HStack className="w-full justify-between">
            <h3 className="text-xs text-muted-foreground">Files</h3>
          </HStack>

          <Suspense fallback={null}>
            <Await resolve={routeData?.files}>
              {(files) =>
                files?.map((file) => (
                  <FileBadge
                    key={file.id}
                    file={file}
                    itemId={itemId}
                    itemType="Material"
                  />
                ))
              }
            </Await>
          </Suspense>
        </VStack>
      </VStack>
      {confirmDisclosure.isOpen && (
        <ConfirmMaterialIdChange
          materialPropertyUpdate={materialPropertyUpdate}
          onClose={() => {
            // this is hacky but the value is already changed in the UI
            window.location.reload();
          }}
          onConfirm={() => {
            onUpdate(
              // @ts-ignore
              materialPropertyUpdate?.field,
              materialPropertyUpdate?.value
            );
            confirmDisclosure.onClose();
            setMaterialPropertyUpdate(null);
          }}
        />
      )}
    </>
  );
};

export default MaterialProperties;

function ConfirmMaterialIdChange({
  materialPropertyUpdate,
  onClose,
  onConfirm,
}: {
  materialPropertyUpdate: {
    field:
      | "materialFormId"
      | "materialSubstanceId"
      | "gradeId"
      | "dimensionId"
      | "finishId"
      | "materialTypeId";
    value: string | null;
  } | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const propertyName = getPropertyName(materialPropertyUpdate?.field ?? "");

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Confirm ID Change</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>Changing this will update the part ID</AlertTitle>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to change the {propertyName} property? Since
            you use generated material IDs this will change the part ID of this
            part, and all related revisions.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Yes, Update IDs
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function getPropertyName(field?: string) {
  switch (field) {
    case "materialFormId":
      return "shape";
    case "materialSubstanceId":
      return "substance";
    case "gradeId":
      return "grade";
    case "dimensionId":
      return "dimensions";
    case "finishId":
      return "finish";
    case "materialTypeId":
      return "type";
    default:
      return field;
  }
}
