import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getAttributeCategoryWithValues } from "~/modules/account/account.service.server";
import { UserAttributesForm } from "~/modules/account/ui/UserAttributes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  const { personId, categoryId } = params;
  if (!personId) throw new Error("Could not find personId");
  if (!categoryId) throw new Error("Could not find categoryId");

  const category = await getAttributeCategoryWithValues(categoryId);

  if (category.error || !category.data) {
    throw redirect(
      path.to.person(personId),
      await flash(
        request,
        error(category.error, "Failed to load attribute category")
      )
    );
  }

  return {
    category: category.data
  };
}

export default function PersonAttributeCategoryRoute() {
  const { category } = useLoaderData<typeof loader>();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {category.emoji ? <span>{category.emoji}</span> : null}{" "}
          {category.name}
        </CardTitle>
        <CardDescription>
          <Badge variant={category.public ? "default" : "secondary"}>
            {category.public ? <Trans>Public</Trans> : <Trans>Private</Trans>}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UserAttributesForm attributeCategory={category} />
      </CardContent>
    </Card>
  );
}
