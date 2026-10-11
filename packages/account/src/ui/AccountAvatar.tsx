// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_URL } from "@carbon/auth";
import type { AvatarProps } from "@carbon/react";
import { Avatar } from "@carbon/react";
import { avatarSrc } from "@carbon/utils";

/** `avatarUrl` is a generated avatar or a path in the public avatars bucket. */
export default function AccountAvatar({
  path,
  ...props
}: AvatarProps & { path: string | null | undefined }) {
  return (
    <Avatar
      src={avatarSrc(
        path,
        (value) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${value}`
      )}
      {...props}
    />
  );
}
