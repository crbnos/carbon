// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { themeValidator } from "~/modules/settings";
import { getTheme, setTheme } from "~/services/theme.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Theme`,
  to: path.to.theme
};

export async function loader({ request }: LoaderFunctionArgs) {
  const theme = getTheme(request);

  return {
    theme: theme ?? "zinc"
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();

  const validation = await validator(themeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  return data(
    {},
    {
      headers: { "Set-Cookie": setTheme(validation.data.theme) }
    }
  );
}
