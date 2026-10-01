// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
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
          <Submit>
            <Trans>Save</Trans>
          </Submit>
        </VStack>
      </ValidatedForm>
    </div>
  );
};

export default PersonalDataForm;
