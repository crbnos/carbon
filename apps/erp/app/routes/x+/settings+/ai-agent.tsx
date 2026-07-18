import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { companyHasPlan } from "@carbon/ee/plan.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { Boolean, Submit } from "~/components/Form";
import { aiAgentSettingsValidator } from "~/modules/agent";
import {
  getCompanySettings,
  updateAiAgentEnabledSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`AI Agent`,
  to: path.to.aiAgentSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });
  const settings = await getCompanySettings(client, companyId);
  const planAllowed = await companyHasPlan(client, companyId, {
    feature: "AI_AGENT"
  });
  return {
    aiAgentEnabled: settings.data?.aiAgentEnabled ?? true,
    planAllowed
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const validation = await validator(aiAgentSettingsValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const update = await updateAiAgentEnabledSetting(
    client,
    companyId,
    validation.data.aiAgentEnabled
  );
  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update AI Agent setting")
      )
    );
  }
  return data({}, await flash(request, success("Updated AI Agent setting")));
}

export default function AiAgentSettingsRoute() {
  const { aiAgentEnabled, planAllowed } = useLoaderData<typeof loader>();

  return (
    <ValidatedForm
      method="post"
      validator={aiAgentSettingsValidator}
      defaultValues={{ aiAgentEnabled }}
    >
      <Card>
        <CardHeader>
          <CardTitle>AI Assistant</CardTitle>
          <CardDescription>
            Enable the in-app AI assistant for everyone in your company. It
            answers questions from the documentation and your live data
            (read-only).
            {planAllowed ? null : " Requires a Business plan."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-[400px]">
            <Boolean
              name="aiAgentEnabled"
              description="Assistant enabled"
              isDisabled={!planAllowed}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!planAllowed}>Save</Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
}
