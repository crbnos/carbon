import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  ItemGroup,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { serviceType, serviceValidator } from "~/modules/parts";

type ServiceFormProps = {
  initialValues: z.infer<typeof serviceValidator>;
};

const useNextServiceIdShortcut = () => {
  const { company } = useUser();
  const { supabase } = useSupabase();
  const [loading, setLoading] = useState<boolean>(false);
  const [serviceId, setServiceId] = useState<string>("");

  const onServiceIdChange = async (newServiceId: string) => {
    if (newServiceId.endsWith("...") && supabase) {
      setLoading(true);

      const prefix = newServiceId.slice(0, -3);
      try {
        const { data } = await supabase
          ?.from("service")
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
          setServiceId(nextId);
        } else {
          setServiceId(`${prefix}${(1).toString().padStart(9, "0")}`);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    } else {
      setServiceId(newServiceId);
    }
  };

  return { serviceId, onServiceIdChange, loading };
};

const ServiceForm = ({ initialValues }: ServiceFormProps) => {
  const { serviceId, onServiceIdChange, loading } = useNextServiceIdShortcut();

  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  const serviceTypeOptions =
    serviceType.map((type) => ({
      label: type,
      value: type,
    })) ?? [];

  return (
    <ValidatedForm
      method="post"
      validator={serviceValidator}
      defaultValues={initialValues}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Service Details" : "New Service"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A service is an intangible activity that can be purchased or sold.
              When a service is purchased, it is accounted for as overhead.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="itemInventoryType" value="Non-Inventory" />
          <div
            className={cn(
              "grid w-full gap-x-8 gap-y-2",
              isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"
            )}
          >
            {isEditing ? (
              <Input name="id" label="Service ID" isReadOnly />
            ) : (
              <InputControlled
                name="id"
                label="Service ID"
                helperText="Use ... to get the next service ID"
                value={serviceId}
                onChange={onServiceIdChange}
                isDisabled={loading}
              />
            )}
            <Input name="name" label="Name" />
            <ItemGroup name="itemGroupId" label="Item Group" />
            <TextArea name="description" label="Description" />

            <Select
              name="serviceType"
              label="Service Type"
              options={serviceTypeOptions}
            />

            <Boolean name="blocked" label="Blocked" />
            {isEditing && <Boolean name="active" label="Active" />}
            <CustomFormFields table="service" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "parts")
                : !permissions.can("create", "parts")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default ServiceForm;
