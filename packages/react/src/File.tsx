import type { ChangeEvent } from "react";
import { useRef } from "react";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";

type FileProps = Omit<ButtonProps, "onChange"> & {
  accept?: string;
  multiple?: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
};

const File = ({
  accept,
  className,
  children,
  multiple = false,
  onChange,
  ...props
}: FileProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex w-auto">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={onChange}
      />
      <Button
        className={className}
        {...props}
        onClick={() => {
          if (fileInputRef.current) fileInputRef.current.click();
        }}
      >
        {children}
      </Button>
    </div>
  );
};

export { File };
