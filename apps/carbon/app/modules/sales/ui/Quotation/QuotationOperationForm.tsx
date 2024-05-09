import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  CustomFormFields,
  EquipmentType,
  Hidden,
  InputControlled,
  Number,
  NumberControlled,
  StandardFactor,
  Submit,
  WorkCellType,
} from "~/components/Form";
import { usePermissions, useRouteData, useUrlParams } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { Quotation } from "~/modules/sales";
import { quotationOperationValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationOperationFormValues = z.infer<typeof quotationOperationValidator>;

type QuotationOperationFormProps = {
  initialValues: QuotationOperationFormValues;
};

const QuotationOperationForm = ({
  initialValues,
}: QuotationOperationFormProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { supabase } = useSupabase();

  const { id: quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const [params] = useUrlParams();
  const quoteAssemblyId = params.get("quoteAssemblyId");

  const isEditing = initialValues.id !== undefined;

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(quoteId));
  const isEditable = ["Draft"].includes(routeData?.quotation?.status ?? "");

  const [workCellData, setWorkCellData] = useState<{
    workCellTypeId: string;
    description: string;
    quotingRate: number;
    laborRate: number;
    overheadRate: number;
  }>({
    workCellTypeId: initialValues.workCellTypeId ?? "",
    description: initialValues.description ?? "",
    quotingRate: initialValues.quotingRate ?? 0,
    laborRate: initialValues.laborRate ?? 0,
    overheadRate: initialValues.overheadRate ?? 0,
  });

  const onWorkCellChange = async (workCellTypeId: string) => {
    if (!supabase || !workCellTypeId) return;
    const { data, error } = await supabase
      .from("workCellType")
      .select("*")
      .eq("id", workCellTypeId)
      .single();

    if (error) throw new Error(error.message);

    setWorkCellData({
      workCellTypeId,
      description: data?.name ?? "",
      quotingRate: data?.quotingRate ?? 0,
      laborRate: data?.laborRate ?? 0,
      overheadRate: data?.overheadRate ?? 0,
    });
  };

  const [equipmentData, setEquipmentData] = useState<{
    equipmentTypeId: string;
    setupHours: number;
  }>({
    equipmentTypeId: initialValues.equipmentTypeId ?? "",
    setupHours: initialValues.setupHours ?? 0,
  });

  const onEquipmentChange = async (equipmentTypeId: string) => {
    if (!supabase || !equipmentTypeId) return;
    const { data, error } = await supabase
      .from("equipmentType")
      .select("*")
      .eq("id", equipmentTypeId)
      .single();

    if (error) throw new Error(error.message);

    setEquipmentData({
      equipmentTypeId,
      setupHours: data?.setupHours ?? 0,
    });
  };

  return (
    <ValidatedForm
      method="post"
      validator={quotationOperationValidator}
      defaultValues={initialValues}
      className="w-full"
      action={
        isEditing
          ? path.to.quoteOperation(quoteId, lineId, initialValues.id!)
          : path.to.newQuoteOperation(quoteId, lineId)
      }
    >
      <Card>
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>{isEditing ? "Operation" : "New Operation"}</CardTitle>
            <CardDescription>
              {isEditing
                ? workCellData.description
                : "A quote operation is a distinct step in the production of a part. It can consume material"}
            </CardDescription>
          </CardHeader>
          <CardAction>
            {isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={<BsThreeDotsVertical />}
                    aria-label="More"
                    variant="secondary"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate("delete")}>
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Operation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="quoteAssemblyId" value={quoteAssemblyId ?? undefined} />

          <VStack>
            <div className="grid w-full gap-x-8 gap-y-2 grid-cols-1 lg:grid-cols-3">
              <WorkCellType
                name="workCellTypeId"
                label="Work Cell"
                onChange={(value) => {
                  onWorkCellChange(value?.value as string);
                }}
              />
              <InputControlled
                name="description"
                label="Description"
                value={workCellData.description}
                onChange={(newValue) => {
                  setWorkCellData((d) => ({ ...d, description: newValue }));
                }}
              />
              <EquipmentType
                name="equipmentTypeId"
                label="Equipment"
                onChange={(value) => onEquipmentChange(value?.value as string)}
              />

              <NumberControlled
                name="setupHours"
                label="Setup Time (hours)"
                minValue={0}
                value={equipmentData.setupHours}
                onChange={(newValue) => {
                  setEquipmentData((d) => ({ ...d, setupHours: newValue }));
                }}
              />
              <Number
                name="productionStandard"
                label="Production Standard"
                minValue={0}
              />
              <StandardFactor name="standardFactor" label="Standard Factor" />

              <NumberControlled
                name="quotingRate"
                label="Quoting Rate"
                minValue={0}
                value={workCellData.quotingRate}
                onChange={(newValue) => {
                  setWorkCellData((d) => ({ ...d, quotingRate: newValue }));
                }}
              />
              <NumberControlled
                name="laborRate"
                label="Labor Rate"
                minValue={0}
                value={workCellData.laborRate}
                onChange={(newValue) => {
                  setWorkCellData((d) => ({ ...d, laborRate: newValue }));
                }}
              />
              <NumberControlled
                name="overheadRate"
                label="Overhead Rate"
                minValue={0}
                value={workCellData.overheadRate}
                onChange={(newValue) => {
                  setWorkCellData((d) => ({ ...d, overheadRate: newValue }));
                }}
              />
              <CustomFormFields table="quoteOperation" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isEditable ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default QuotationOperationForm;
