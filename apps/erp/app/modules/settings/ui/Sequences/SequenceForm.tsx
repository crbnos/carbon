import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { sequenceValidator } from "~/modules/settings";
import { path } from "~/utils/path";
import { interpolateSequenceDate } from "~/utils/string";

type SequenceFormProps = {
  initialValues: z.infer<typeof sequenceValidator> & {
    name: string;
  };
  formatLocked?: boolean;
};

const SequenceForm = ({
  initialValues,
  formatLocked = false
}: SequenceFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [prefix, setPrefix] = useState(initialValues.prefix ?? "");
  const [suffix, setSuffix] = useState(initialValues.suffix ?? "");
  const [next, setNext] = useState(initialValues.next ?? "1");
  const [size, setSize] = useState(initialValues.size ?? 5);

  const makePreview = () => {
    const p = interpolateSequenceDate(prefix);
    const s = interpolateSequenceDate(suffix);

    return `${p}${next.toString().padStart(size, "0")}${s}`;
  };

  const isDisabled = !permissions.can("update", "settings");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={sequenceValidator}
          method="post"
          action={path.to.tableSequence(initialValues.table)}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{`${initialValues.name}`} Sequence</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="table" />
            <VStack spacing={4}>
              <Heading size="h2">{makePreview()}</Heading>

              {formatLocked && (
                <p className="text-muted-foreground text-sm">
                  <Trans>Format locked after first use</Trans>
                </p>
              )}
              <Input
                name="prefix"
                label={t`Prefix`}
                isDisabled={formatLocked}
                onChange={(e) => setPrefix(e.target.value)}
              />
              <Number
                name="next"
                minValue={0}
                label={t`Current`}
                onChange={setNext}
              />
              <Number
                name="size"
                minValue={0}
                maxValue={30}
                label={t`Size`}
                isDisabled={formatLocked}
                onChange={setSize}
              />
              <Number
                name="step"
                minValue={0}
                maxValue={10000}
                label={t`Step`}
                isDisabled={formatLocked}
              />
              <Input
                name="suffix"
                label={t`Suffix`}
                isDisabled={formatLocked}
                onChange={(e) => setSuffix(e.target.value)}
              />
              <VStack spacing={0}>
                <p className="text-muted-foreground text-sm">{`%{yyyy} = Full Year`}</p>
                <p className="text-muted-foreground text-sm">{`%{yy} = Year`}</p>
                <p className="text-muted-foreground text-sm">{`%{mm} = Month`}</p>
                <p className="text-muted-foreground text-sm">{`%{dd} = Day`}</p>
                <p className="text-muted-foreground text-sm">{`%{hh} = Hour`}</p>
                <p className="text-muted-foreground text-sm">{`%{mm} = Minute`}</p>
                <p className="text-muted-foreground text-sm">{`%{ss} = Second`}</p>
              </VStack>
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default SequenceForm;
