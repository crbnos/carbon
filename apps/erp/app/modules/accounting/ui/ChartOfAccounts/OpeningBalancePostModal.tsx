import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck } from "react-icons/lu";
import { DatePicker, Submit } from "~/components/Form";
import { useCompanyToday } from "~/hooks";
import { path } from "~/utils/path";
import { openingBalanceValidator } from "../../accounting.models";

type OpeningBalancePostModalProps = {
  /** JSON array of { accountId, amount } for the non-zero rows. */
  linesJson: string;
  /** How many accounts carry a balance — shown for confirmation. */
  count: number;
  open: boolean;
  onClose: () => void;
};

const OpeningBalancePostModal = ({
  linesJson,
  count,
  open,
  onClose
}: OpeningBalancePostModalProps) => {
  const { t } = useLingui();
  const today = useCompanyToday();

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            method="post"
            action={path.to.chartOfAccounts}
            validator={openingBalanceValidator}
            defaultValues={{ postingDate: today, lines: [] }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Post opening balances</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <input type="hidden" name="lines" value={linesJson} />
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A single balanced journal entry will be posted as of the
                    date below, with the difference offset to Retained Earnings.
                  </Trans>
                </p>
                <DatePicker name="postingDate" label={t`As of date`} />
                <p className="text-xs text-muted-foreground">
                  <Plural
                    value={count}
                    one="# account with a balance"
                    other="# accounts with a balance"
                  />
                </p>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit leftIcon={<LuCheckCheck />}>
                  <Trans>Post</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default OpeningBalancePostModal;
