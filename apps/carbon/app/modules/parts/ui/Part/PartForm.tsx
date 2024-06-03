import {
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  cn,
  toast,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  PartGroup,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import {
  partReplenishmentSystems,
  partTypes,
  partValidator,
} from "~/modules/parts";
import { path } from "~/utils/path";

type PartFormProps = {
  initialValues: z.infer<typeof partValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const useNextPartIdShortcut = () => {
  const { company } = useUser();
  const { supabase } = useSupabase();
  const [loading, setLoading] = useState<boolean>(false);
  const [partId, setPartId] = useState<string>("");

  const onPartIdChange = async (newPartId: string) => {
    if (newPartId.endsWith("...") && supabase) {
      setLoading(true);

      const prefix = newPartId.slice(0, -3);
      try {
        const { data } = await supabase
          ?.from("part")
          .select("id")
          .eq("companyId", company.id)
          .ilike("id", `${prefix}%`)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.id) {
          const sequence = data.id.slice(prefix.length);
          const currentSequence = parseInt(sequence);
          const nextSequence = currentSequence + 1;
          const nextId = `${prefix}${nextSequence
            .toString()
            .padStart(
              sequence.length -
                (data.id.split(`${currentSequence}`)?.[1].length ?? 0),
              "0"
            )}`;
          setPartId(nextId);
        } else {
          setPartId(`${prefix}${(1).toString().padStart(9, "0")}`);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    } else {
      setPartId(newPartId);
    }
  };

  return { partId, onPartIdChange, loading };
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const PartForm = ({ initialValues, type = "card", onClose }: PartFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created part`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create part: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { partId, onPartIdChange, loading } = useNextPartIdShortcut();
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const partTypeOptions =
    partTypes.map((partType) => ({
      label: partType,
      value: partType,
    })) ?? [];

  const partReplenishmentSystemOptions =
    partReplenishmentSystems.map((partReplenishmentSystem) => ({
      label: partReplenishmentSystem,
      value: partReplenishmentSystem,
    })) ?? [];

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newPart}
            method="post"
            validator={partValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Part Details" : "New Part"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A part contains the information about a specific item that can
                  be purchased or manufactured.
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-2",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Part ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Part ID"
                    helperText={
                      startsWithLetter(partId)
                        ? "Use ... to get the next part ID"
                        : undefined
                    }
                    value={partId}
                    onChange={onPartIdChange}
                    isDisabled={loading}
                  />
                )}

                <Input name="name" label="Name" />
                <PartGroup name="partGroupId" label="Part Group" />
                {isEditing && (
                  <TextArea name="description" label="Description" />
                )}
                <Select
                  name="replenishmentSystem"
                  label="Replenishment System"
                  options={partReplenishmentSystemOptions}
                />
                <Select
                  name="partType"
                  label="Part Type"
                  options={partTypeOptions}
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                <Boolean name="blocked" label="Blocked" />
                {isEditing && <Boolean name="active" label="Active" />}

                <CustomFormFields table="part" />
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isDisabled={
                  isEditing
                    ? !permissions.can("update", "parts")
                    : !permissions.can("create", "parts")
                }
              >
                Save
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default PartForm;
