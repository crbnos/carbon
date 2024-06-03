import type { Database } from "@carbon/database";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  ItemGroup,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { itemValidator } from "~/modules/parts";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

type ItemFormProps = {
  initialValues: z.infer<typeof itemValidator>;
  type: Database["public"]["Enums"]["itemType"];
};

function getLabel(type: Database["public"]["Enums"]["itemType"]) {
  return capitalize(type);
}

const ItemForm = ({ initialValues, type }: ItemFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  return (
    <Card>
      <ValidatedForm
        action={path.to.api.item(type)}
        method="post"
        validator={itemValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>{getLabel(type)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid w-full gap-x-8 gap-y-2 grid-cols-1 md:grid-cols-3">
            <Input
              isReadOnly
              name="readableId"
              label={`${getLabel(type)} ID`}
            />

            <Input name="name" label="Name" />
            <ItemGroup name="itemGroupId" label="Item Group" />

            <Boolean name="active" label="Active" />
            <Boolean name="blocked" label="Blocked" />

            <CustomFormFields table="part" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemForm;
