import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { datetime } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { Radios, Submit } from "~/components/Form";
import {
  DEFAULT_WEEKLY_GOAL_XP,
  getLearnPreference,
  learnPreferenceValidator,
  upsertLearnPreference,
  WEEKLY_GOAL_OPTIONS
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const preference = await getLearnPreference(client, userId, companyId);
  return {
    weeklyGoalXp: preference.data?.weeklyGoalXp ?? DEFAULT_WEEKLY_GOAL_XP
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const validation = await validator(learnPreferenceValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const update = await upsertLearnPreference(client, {
    userId,
    companyId,
    weeklyGoalXp: validation.data.weeklyGoalXp,
    updatedAt: datetime.timestamp()
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to save your weekly goal")
      )
    );
  }

  throw redirect(
    path.to.learn,
    await flash(request, success("Weekly goal updated"))
  );
}

export default function LearnPreferencesRoute() {
  const { weeklyGoalXp } = useLoaderData<typeof loader>();
  const { t } = useLingui();

  return (
    <div className="w-full max-w-lg mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>{t`Your weekly goal`}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {t`A week counts toward your streak when you reach this much XP. Weeks, not days — so a weekend off never breaks it.`}
          </span>
        </CardHeader>
        <CardContent>
          <ValidatedForm
            method="post"
            validator={learnPreferenceValidator}
            defaultValues={{ weeklyGoalXp }}
          >
            <VStack spacing={4}>
              <Radios
                name="weeklyGoalXp"
                label={t`Weekly XP goal`}
                options={WEEKLY_GOAL_OPTIONS.map((value) => ({
                  label:
                    value === 100
                      ? t`${value} XP — a unit a week`
                      : value === 200
                        ? t`${value} XP — steady`
                        : t`${value} XP — ambitious`,
                  value: String(value)
                }))}
              />
              <Submit>{t`Save`}</Submit>
            </VStack>
          </ValidatedForm>
        </CardContent>
      </Card>
    </div>
  );
}
