import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import { Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountPersonalDataValidator } from "../../account.models";
import type { PersonalData } from "../../types";

type PersonalDataFormProps = {
  personalData: PersonalData;
};

const PersonalDataForm = ({ personalData }: PersonalDataFormProps) => {
  return (
    <div className="w-full">
      <ValidatedForm
        method="post"
        action={path.to.accountPersonal}
        validator={accountPersonalDataValidator}
        defaultValues={personalData}
      >
        <VStack spacing={4} className="mt-4">
          <Submit>Save</Submit>
        </VStack>
      </ValidatedForm>
    </div>
  );
};

export default PersonalDataForm;
