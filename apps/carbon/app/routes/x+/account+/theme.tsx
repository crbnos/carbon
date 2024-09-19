import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { ThemeForm, themeValidator } from "~/modules/settings";
import { getTheme, setTheme } from "~/services/theme.server";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Theme",
  to: path.to.theme,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const theme = getTheme(request);

  return json({
    theme: theme ?? "zinc",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();

  const validation = await validator(themeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  return json(
    {},
    {
      headers: { "Set-Cookie": setTheme(validation.data.theme) },
    }
  );
}

export default function Theme() {
  const { theme } = useLoaderData<typeof loader>();

  const initialValues = {
    theme,
  };

  return <ThemeForm theme={initialValues} />;
}
