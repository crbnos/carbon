import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { Hidden, Input, Submit, TextArea } from "~/components/Form";
import { accountProfileValidator } from "~/modules/account";
import type { User } from "~/modules/users";
import { path } from "~/utils/path";

type ProfileFormProps = {
  user: User;
};

const ProfileForm = ({ user }: ProfileFormProps) => {
  const { personId } = useParams();
  const isSelf = !personId;

  return (
    <ValidatedForm
      method="post"
      action={isSelf ? path.to.profile : path.to.person(personId)}
      validator={accountProfileValidator}
      defaultValues={user}
      className="w-full"
    >
      <VStack spacing={4}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <Input name="firstName" label="First Name" />
          <Input name="lastName" label="Last Name" />
        </div>
        <TextArea
          name="about"
          label="About"
          characterLimit={160}
          className="my-2"
        />
        <Hidden name="intent" value="about" />
        <Submit>Save</Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileForm;
