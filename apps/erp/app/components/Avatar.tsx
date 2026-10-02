// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AvatarProps as AvatarBaseProps } from "@carbon/react";
import { Avatar as AvatarBase } from "@carbon/react";
import { forwardRef } from "react";
import { getStoragePath } from "~/utils/path";

type AvatarProps = AvatarBaseProps & {
  path?: string | null;
  bucket?: string;
  imageUrl?: string | null;
};

const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ name, path, bucket = "avatars", imageUrl, ...props }, ref) => {
    const finalImageUrl = imageUrl
      ? imageUrl
      : path
        ? getStoragePath(bucket, path)
        : undefined;

    return <AvatarBase src={finalImageUrl} name={name} ref={ref} {...props} />;
  }
);
Avatar.displayName = "Avatar";

export default Avatar;
