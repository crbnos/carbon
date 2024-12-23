import type { AvatarProps as AvatarBaseProps } from "@carbon/react";
import { Avatar as AvatarBase } from "@carbon/react";
import { forwardRef } from "react";
import { getStoragePath } from "~/utils/path";

type AvatarProps = AvatarBaseProps & {
  path?: string | null;
  bucket?: string;
};

const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ name, path, bucket = "avatars", ...props }, ref) => {
    const imagePath = path ? getStoragePath(bucket, path) : undefined;

    return <AvatarBase src={imagePath} name={name} ref={ref} {...props} />;
  }
);
Avatar.displayName = "Avatar";

export default Avatar;
