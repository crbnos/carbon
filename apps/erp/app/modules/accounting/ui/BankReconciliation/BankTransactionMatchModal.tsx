import {
  Badge,
  Button,
  Card,
  CardContent,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Form } from "react-router";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  BEST_MATCH_SCORE_THRESHOLD,
  POSSIBLE_MATCH_SCORE_THRESHOLD,
  scoreBankTransactionMatchCandidate
} from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

export type JournalLineCandidate = {
  id: string;
  amount: number;
  description: string | null;
  journal: { postingDate: string; status: string } | null;
};

type BankTransactionMatchModalProps = {
  companyBankAccountId: string;
  transactionId: string;
  transactionDescription: string;
  transactionAmount: number;
  transactionPostedDate: string;
  currencyCode: string;
  candidates: JournalLineCandidate[];
  onClose: () => void;
};

/**
 * NetSuite "Method 1: Manual Match" — pick the GL entry to clear a bank line
 * against, instead of relying on the automatic exact-match pass.
 */
const BankTransactionMatchModal = ({
  companyBankAccountId,
  transactionId,
  transactionDescription,
  transactionAmount,
  transactionPostedDate,
  currencyCode,
  candidates,
  onClose
}: BankTransactionMatchModalProps) => {
  const { t } = useLingui();
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

  // Rank against this specific transaction's amount/date — same idea as
  // Midday's confidence score, minus the semantic/embedding term we have no
  // pipeline for. Sorting + a "Best match" hint only; matching itself always
  // stays an explicit click.
  const rankedCandidates = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.journal !== null)
        .map((candidate) => ({
          candidate,
          score: scoreBankTransactionMatchCandidate(
            { amount: transactionAmount, postedDate: transactionPostedDate },
            {
              amount: candidate.amount,
              postingDate: candidate.journal!.postingDate
            }
          )
        }))
        .sort((a, b) => b.score - a.score),
    [candidates, transactionAmount, transactionPostedDate]
  );

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Match "{transactionDescription}"</Trans>
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <VStack spacing={2}>
              {candidates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t`No posted GL entries are available to match against this account.`}
                </p>
              )}
              {rankedCandidates.map(({ candidate, score }) => (
                <Card key={candidate.id}>
                  <CardContent className="py-3">
                    <HStack className="justify-between">
                      <VStack spacing={0}>
                        <HStack spacing={2}>
                          <span className="text-sm font-medium">
                            {candidate.description ?? t`(No description)`}
                          </span>
                          {score >= BEST_MATCH_SCORE_THRESHOLD && (
                            <Badge variant="green">{t`Best match`}</Badge>
                          )}
                          {score >= POSSIBLE_MATCH_SCORE_THRESHOLD &&
                            score < BEST_MATCH_SCORE_THRESHOLD && (
                              <Badge variant="yellow">{t`Possible match`}</Badge>
                            )}
                        </HStack>
                        <span className="text-xs text-muted-foreground">
                          {candidate.journal
                            ? formatDate(candidate.journal.postingDate)
                            : ""}{" "}
                          · {currencyFormatter.format(Number(candidate.amount))}
                        </span>
                      </VStack>
                      <Form
                        method="post"
                        action={path.to.bankTransactionMatch(
                          companyBankAccountId,
                          transactionId
                        )}
                      >
                        <input
                          type="hidden"
                          name="journalLineId"
                          value={candidate.id}
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          {t`Select`}
                        </Button>
                      </Form>
                    </HStack>
                  </CardContent>
                </Card>
              ))}
            </VStack>
          </ModalDrawerBody>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default BankTransactionMatchModal;
