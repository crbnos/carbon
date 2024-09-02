import { useControlField, useField } from "@carbon/form";
import {
  FormControl,
  FormErrorMessage,
  RichText as RichTextBase,
  useRichText,
} from "@carbon/react";
import type { ComponentProps } from "react";
import { useEffect } from "react";

type RichTextProps = Omit<ComponentProps<typeof RichTextBase>, "editor"> & {
  name: string;
  output?: "html" | "json" | "text";
};

const RichText = ({ name, output = "html", ...props }: RichTextProps) => {
  const { getInputProps, error, defaultValue } = useField(name);
  const [value, setValue] = useControlField<string>(name);
  const richText = useRichText(defaultValue);

  useEffect(() => {
    if (!value) {
      richText?.commands.clearContent(true);
    }
  }, [value, richText]);

  useEffect(() => {
    if (richText) {
      richText.on("update", () => {
        switch (output) {
          case "html":
            setValue(richText.getHTML());
            break;
          case "json":
            setValue(JSON.stringify(richText.getJSON()));
            break;
          case "text":
            setValue(richText.getText());
            break;
          default:
            setValue(richText.getHTML());
            break;
        }
      });
    }

    return () => {
      if (richText) {
        richText.off("update");
      }
    };
  }, [richText, output, setValue]);

  return (
    <FormControl isInvalid={!!error}>
      <RichTextBase {...props} editor={richText} />
      <input
        {...getInputProps({
          // @ts-ignore
          id: name,
        })}
        value={value}
        type="hidden"
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default RichText;
