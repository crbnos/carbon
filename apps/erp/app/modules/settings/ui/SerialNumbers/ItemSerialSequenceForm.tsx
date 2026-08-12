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
import { Hidden, Input, Item, Number, Submit } from "~/components/Form";
import { useCompanyTimeZone, usePermissions } from "~/hooks";
import { itemSerialSequenceValidator } from "~/modules/settings";
import { path } from "~/utils/path";
import { interpolateSequenceDate } from "~/utils/string";

type ItemSerialSequenceFormProps = {
  initialValues: z.infer<typeof itemSerialSequenceValidator>;
  // Items that already have a sequence — excluded from the picker so a second
  // sequence can't be created for the same item.
  configuredItemIds?: string[];
};

const ItemSerialSequenceForm = ({
  initialValues,
  configuredItemIds = []
}: ItemSerialSequenceFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = initialValues.id !== undefined;

  const [prefix, setPrefix] = useState(initialValues.prefix ?? "");
  const [suffix, setSuffix] = useState(initialValues.suffix ?? "");
  const [next, setNext] = useState(initialValues.next ?? 0);
  const [size, setSize] = useState(initialValues.size ?? 5);
  const [step, setStep] = useState(initialValues.step ?? 1);

  // Preview in the company timezone — the same calendar serial numbers are
  // issued in — not the browser's.
  const timezone = useCompanyTimeZone();
  const makePreview = () => {
    // %{location} is resolved at issue time from the item's location; for the
    // preview we stand in a sample location code ("HQ") so the token doesn't
    // show through literally.
    const p = interpolateSequenceDate(prefix, timezone).replace(
      /%{location}/g,
      "HQ"
    );
    const s = interpolateSequenceDate(suffix, timezone).replace(
      /%{location}/g,
      "HQ"
    );
    // Preview the NEXT number that will be issued (current counter + step),
    // not the current counter itself — so a fresh sequence shows "00001".
    return `${p}${(next + step).toString().padStart(size, "0")}${s}`;
  };

  const isDisabled = isEditing
    ? !permissions.can("update", "settings")
    : !permissions.can("create", "settings");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={itemSerialSequenceValidator}
          method="post"
          action={
            isEditing
              ? path.to.serialNumberSequence(initialValues.id!)
              : path.to.newSerialNumberSequence
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Serial Number` : t`New Serial Number`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Heading size="h2">{makePreview()}</Heading>

              {isEditing ? (
                <Item name="itemId" label={t`Item`} type="Item" isReadOnly />
              ) : (
                <Item
                  name="itemId"
                  label={t`Item`}
                  type="Item"
                  blacklist={configuredItemIds}
                  helperText={t`Serial numbers are only generated for serial- or batch-tracked items.`}
                />
              )}

              <Input
                name="prefix"
                label={t`Prefix`}
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
                minValue={1}
                maxValue={20}
                label={t`Size`}
                onChange={setSize}
              />
              <Number
                name="step"
                minValue={1}
                maxValue={10000}
                label={t`Step`}
                onChange={setStep}
              />
              <Input
                name="suffix"
                label={t`Suffix`}
                onChange={(e) => setSuffix(e.target.value)}
              />
              <VStack spacing={0}>
                <p className="text-muted-foreground text-sm">{`%{yyyy} = Full Year`}</p>
                <p className="text-muted-foreground text-sm">{`%{yy} = Year`}</p>
                <p className="text-muted-foreground text-sm">{`%{mm} = Month`}</p>
                <p className="text-muted-foreground text-sm">{`%{ww} = Week`}</p>
                <p className="text-muted-foreground text-sm">{`%{dd} = Day`}</p>
                <p className="text-muted-foreground text-sm">{`%{location} = Location code`}</p>
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

export default ItemSerialSequenceForm;
