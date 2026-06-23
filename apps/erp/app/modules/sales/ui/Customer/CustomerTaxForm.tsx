import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  toast
} from "@carbon/react";
import { isEoriCountry } from "@carbon/utils";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import { LuPaperclip } from "react-icons/lu";
import type { z } from "zod";
import { FileDropzone } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Boolean, Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { taxExemptionReasons } from "~/modules/shared";
import { customerTaxValidator } from "../../sales.models";

type CustomerTaxFormProps = {
  initialValues: z.infer<typeof customerTaxValidator> & {
    taxExemptionCertificatePath?: string | null;
  };
};

const CustomerTaxForm = ({ initialValues }: CustomerTaxFormProps) => {
  const taxExemptionReasonOptions = taxExemptionReasons.map((reason) => ({
    label: <Enumerable value={reason} />,
    value: reason
  }));
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const companyId = company.id;
  const [certificatePath, setCertificatePath] = useState(
    initialValues.taxExemptionCertificatePath ?? ""
  );
  const [taxExempt, setTaxExempt] = useState(initialValues.taxExempt ?? false);

  const isDisabled = !permissions.can("update", "sales");

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !carbon) return;

      const fileExtension = file.name.split(".").pop();
      const fileName = `${companyId}/tax-certificates/${nanoid()}.${fileExtension}`;

      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);

      if (result.error) {
        toast.error("Failed to upload certificate");
      } else {
        setCertificatePath(result.data.path);
        toast.success("Certificate uploaded");
      }
    },
    [carbon, companyId]
  );

  return (
    <ValidatedForm
      method="post"
      validator={customerTaxValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Tax Information</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="customerId" />
          <input
            type="hidden"
            name="taxExemptionCertificatePath"
            value={certificatePath}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Input name="taxId" label="Tax ID" />
            <Input name="vatNumber" label="VAT Number" />
            {isEoriCountry(company.countryCode) ? (
              <Input name="eori" label="EORI" />
            ) : (
              <div />
            )}
            <div className="col-span-3">
              <Boolean
                name="taxExempt"
                label="Tax Exempt"
                onChange={(value) => setTaxExempt(value)}
              />
            </div>
            {taxExempt && (
              <>
                <Select
                  name="taxExemptionReason"
                  label="Exemption Reason"
                  options={taxExemptionReasonOptions}
                  placeholder="Select Reason"
                />
                <Input
                  name="taxExemptionCertificateNumber"
                  label="Certificate Number"
                />
              </>
            )}
          </div>
          {taxExempt && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Exemption Certificate
                </label>
                {certificatePath && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<LuPaperclip />}
                    asChild
                  >
                    <a
                      href={`/file/preview/private/${certificatePath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Certificate
                    </a>
                  </Button>
                )}
              </div>
              <FileDropzone
                onDrop={onDrop}
                accept={{
                  "application/pdf": [".pdf"],
                  "image/*": [".png", ".jpg", ".jpeg"]
                }}
                multiple={false}
              />
            </div>
          )}
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>Save</Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default CustomerTaxForm;
