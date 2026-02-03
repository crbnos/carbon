import {
  Array as ArrayInput,
  Hidden,
  Input,
  MultiSelect,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Select,
  SelectControlled,
  Submit,
  useFormContext,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Kbd,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDebounce,
  useDisclosure,
  useKeyboardShortcuts,
  usePrettifyShortcut,
  VStack
} from "@carbon/react";
import { Reorder } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuArrowRightLeft,
  LuCircleDot,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuHash,
  LuPencil,
  LuSquareCheck,
  LuToggleLeft,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import { Empty } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { Training, TrainingQuestion } from "~/modules/resources";
import {
  trainingQuestionType,
  trainingQuestionValidator
} from "~/modules/resources";
import { path } from "~/utils/path";

export default function TrainingExplorer() {
  const prettifyShortcut = usePrettifyShortcut();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const trainingData = useRouteData<{
    training: Training;
  }>(path.to.training(id));
  const permissions = usePermissions();
  const sortOrderFetcher = useFetcher<{
    success: boolean;
  }>();

  const questionDisclosure = useDisclosure();
  const deleteQuestionDisclosure = useDisclosure();

  const [selectedQuestion, setSelectedQuestion] =
    useState<TrainingQuestion | null>(null);

  const questions = useMemo(
    () => trainingData?.training.trainingQuestion ?? [],
    [trainingData]
  );

  const maxSortOrder =
    questions.reduce((acc, q) => Math.max(acc, q.sortOrder), 0) ?? 0;

  const trainingQuestionInitialValues = {
    id: selectedQuestion?.id,
    trainingId: id,
    question: selectedQuestion?.question ?? "",
    type: selectedQuestion?.type ?? "MultipleChoice",
    sortOrder: selectedQuestion?.sortOrder ?? maxSortOrder + 1,
    required: selectedQuestion?.required ?? true,
    options: selectedQuestion?.options ?? [],
    correctAnswers: selectedQuestion?.correctAnswers ?? [],
    correctBoolean: selectedQuestion?.correctBoolean ?? false,
    matchingPairs: selectedQuestion?.matchingPairs
      ? JSON.stringify(selectedQuestion.matchingPairs)
      : "[]",
    correctNumber: selectedQuestion?.correctNumber ?? undefined,
    tolerance: selectedQuestion?.tolerance ?? undefined
  };

  const isDisabled = trainingData?.training?.status !== "Draft";

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(questions)
      ? questions.sort((a, b) => a.sortOrder - b.sortOrder).map((q) => q.id)
      : []
  );

  useEffect(() => {
    if (Array.isArray(questions)) {
      const sorted = [...questions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((q) => q.id);
      setSortOrder(sorted);
    }
  }, [questions]);

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.trainingQuestionOrder(id)
      });
    },
    2500,
    true
  );

  const onDeleteQuestion = (question: TrainingQuestion) => {
    if (isDisabled) return;
    setSelectedQuestion(question);
    deleteQuestionDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedQuestion(null);
    deleteQuestionDisclosure.onClose();
  };

  const onEditQuestion = (question: TrainingQuestion) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedQuestion(question);
    });
    questionDisclosure.onOpen();
  };

  const newQuestionRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+a": (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!isDisabled) {
        newQuestionRef.current?.click();
      }
    }
  });

  const questionMap = useMemo(
    () =>
      questions.reduce<Record<string, TrainingQuestion>>(
        (acc, q) => ({ ...acc, [q.id]: q }),
        {}
      ) ?? {},
    [questions]
  );

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {questions && questions.length > 0 ? (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full"
              disabled={isDisabled}
            >
              {sortOrder.map((sortId) => (
                <Reorder.Item
                  key={sortId}
                  value={sortId}
                  dragListener={!isDisabled}
                >
                  <TrainingQuestionItem
                    key={sortId}
                    isDisabled={isDisabled}
                    question={questionMap[sortId]}
                    onDelete={onDeleteQuestion}
                    onEdit={onEditQuestion}
                  />
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            <Empty>
              {permissions.can("update", "resources") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={() => {
                    flushSync(() => {
                      setSelectedQuestion(null);
                    });
                    questionDisclosure.onOpen();
                  }}
                >
                  Add Question
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex-none border-t border-border p-4">
          <Tooltip>
            <TooltipTrigger className="w-full">
              <Button
                ref={newQuestionRef}
                className="w-full"
                isDisabled={
                  isDisabled || !permissions.can("update", "resources")
                }
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={() => {
                  flushSync(() => {
                    setSelectedQuestion(null);
                  });
                  questionDisclosure.onOpen();
                }}
              >
                Add Question
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>
                <span>Add Question</span>
                <Kbd>{prettifyShortcut("Command+Shift+a")}</Kbd>
              </HStack>
            </TooltipContent>
          </Tooltip>
        </div>
      </VStack>
      {questionDisclosure.isOpen && (
        <TrainingQuestionForm
          // @ts-ignore
          initialValues={trainingQuestionInitialValues}
          isDisabled={isDisabled}
          onClose={questionDisclosure.onClose}
        />
      )}
      {deleteQuestionDisclosure.isOpen && selectedQuestion && (
        <DeleteTrainingQuestion
          question={selectedQuestion}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

function TrainingQuestionTypeIcon({
  type,
  className
}: {
  type: TrainingQuestion["type"];
  className?: string;
}) {
  switch (type) {
    case "MultipleChoice":
      return <LuCircleDot className={className} />;
    case "TrueFalse":
      return <LuToggleLeft className={className} />;
    case "MultipleAnswers":
      return <LuSquareCheck className={className} />;
    case "MatchingPairs":
      return <LuArrowRightLeft className={className} />;
    case "Numerical":
      return <LuHash className={className} />;
    default:
      return null;
  }
}

type TrainingQuestionProps = {
  question: TrainingQuestion;
  isDisabled: boolean;
  onEdit: (question: TrainingQuestion) => void;
  onDelete: (question: TrainingQuestion) => void;
};

function TrainingQuestionItem({
  question,
  isDisabled,
  onEdit,
  onDelete
}: TrainingQuestionProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const permissions = usePermissions();
  if (!question || !question.id || !question.question) return null;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center hover:bg-accent/30 relative border-b bg-card"
      )}
    >
      {!isDisabled && (
        <IconButton
          aria-label="Drag handle"
          icon={<LuGripVertical />}
          variant="ghost"
          disabled={isDisabled}
          className="cursor-grab"
        />
      )}
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Tooltip>
            <TooltipTrigger>
              <TrainingQuestionTypeIcon
                type={question.type}
                className="flex-shrink-0"
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-foreground text-sm">{question.type}</p>
            </TooltipContent>
          </Tooltip>
          <VStack spacing={0} className="flex-grow">
            <HStack>
              <p className="text-foreground text-sm">{question.question}</p>
            </HStack>
            <p className="text-muted-foreground text-xs">
              {question.type === "MultipleChoice" &&
                `${question.correctAnswers?.[0] ?? "None"}`}
              {question.type === "TrueFalse" &&
                `${question.correctBoolean ? "True" : "False"}`}
              {question.type === "MultipleAnswers" &&
                `${question.correctAnswers?.length ?? 0} correct answers`}
              {question.type === "MatchingPairs" && "Matching pairs"}
              {question.type === "Numerical" && `${question.correctNumber}`}
            </p>
          </VStack>
        </HStack>
      </VStack>
      {!isDisabled && (
        <div className="absolute right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More"
                className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(question);
                }}
              >
                <DropdownMenuIcon icon={<LuPencil />} />
                Edit Question
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!permissions.can("update", "resources")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(question);
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Question
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </HStack>
  );
}

function DeleteTrainingQuestion({
  question,
  onCancel
}: {
  question: TrainingQuestion;
  onCancel: () => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!question.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteTrainingQuestion(id, question.id)}
      name={question.question ?? "this question"}
      text={`Are you sure you want to delete this question? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}

function TrainingQuestionForm({
  initialValues,
  isDisabled,
  onClose
}: {
  initialValues: z.infer<typeof trainingQuestionValidator>;
  isDisabled: boolean;
  onClose: () => void;
}) {
  const { id: trainingId } = useParams();
  if (!trainingId) throw new Error("id not found");

  const [type, setType] = useState<TrainingQuestion["type"]>(
    initialValues.type
  );
  const [correctBoolean, setCorrectBoolean] = useState(
    initialValues.correctBoolean ?? false
  );
  const [matchingPairs, setMatchingPairs] = useState<
    Array<{ left: string; right: string }>
  >(() => {
    try {
      if (typeof initialValues.matchingPairs === "string") {
        return JSON.parse(initialValues.matchingPairs || "[]");
      }
      return initialValues.matchingPairs ?? [];
    } catch {
      return [];
    }
  });

  const fetcher = useFetcher<{
    success: boolean;
  }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const typeOptions = useMemo(
    () =>
      trainingQuestionType.map((t) => ({
        label: (
          <HStack>
            <TrainingQuestionTypeIcon type={t} className="mr-2" />
            {t === "MultipleChoice"
              ? "Multiple Choice"
              : t === "TrueFalse"
                ? "True/False"
                : t === "MultipleAnswers"
                  ? "Multiple Answers"
                  : t === "MatchingPairs"
                    ? "Matching Pairs"
                    : "Numerical"}
          </HStack>
        ),
        value: t
      })),
    []
  );

  const isEditing = !!initialValues.id;

  const addMatchingPair = () => {
    setMatchingPairs([...matchingPairs, { left: "", right: "" }]);
  };

  const removeMatchingPair = (index: number) => {
    setMatchingPairs(matchingPairs.filter((_, i) => i !== index));
  };

  const updateMatchingPair = (
    index: number,
    field: "left" | "right",
    value: string
  ) => {
    const updated = [...matchingPairs];
    updated[index][field] = value;
    setMatchingPairs(updated);
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent position="left">
        <ValidatedForm
          method="post"
          action={
            isEditing
              ? path.to.trainingQuestion(trainingId, initialValues.id!)
              : path.to.newTrainingQuestion(trainingId)
          }
          defaultValues={initialValues}
          validator={trainingQuestionValidator}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Question" : "Add Question"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="trainingId" />
            <Hidden name="sortOrder" />
            <Hidden name="id" />
            <Hidden name="correctBoolean" value={String(correctBoolean)} />
            <Hidden
              name="matchingPairs"
              value={JSON.stringify(matchingPairs)}
            />
            <VStack spacing={4}>
              <SelectControlled
                name="type"
                label="Type"
                options={typeOptions}
                value={type}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as TrainingQuestion["type"]);
                  }
                }}
              />
              <Input name="question" label="Question" />

              {(type === "MultipleChoice" || type === "MultipleAnswers") && (
                <OptionsWithCorrectAnswers
                  type={type}
                  initialCorrectAnswers={initialValues.correctAnswers ?? []}
                  initialOptions={initialValues.options ?? []}
                />
              )}

              {type === "TrueFalse" && (
                <VStack spacing={2} className="w-full">
                  <Label>Correct Answer</Label>
                  <HStack>
                    <Switch
                      checked={correctBoolean}
                      onCheckedChange={setCorrectBoolean}
                    />
                    <span>{correctBoolean ? "True" : "False"}</span>
                  </HStack>
                </VStack>
              )}

              {type === "MatchingPairs" && (
                <VStack spacing={2} className="w-full">
                  <Label>Matching Pairs</Label>
                  {matchingPairs.map((pair, index) => (
                    <HStack key={index} className="w-full">
                      <Input
                        name={`pair-left-${index}`}
                        placeholder="Left item"
                        value={pair.left}
                        onChange={(e) =>
                          updateMatchingPair(index, "left", e.target.value)
                        }
                      />
                      <Input
                        name={`pair-right-${index}`}
                        placeholder="Right item"
                        value={pair.right}
                        onChange={(e) =>
                          updateMatchingPair(index, "right", e.target.value)
                        }
                      />
                      <IconButton
                        aria-label="Remove pair"
                        icon={<LuTrash />}
                        variant="ghost"
                        onClick={() => removeMatchingPair(index)}
                      />
                    </HStack>
                  ))}
                  <Button
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    onClick={addMatchingPair}
                    type="button"
                  >
                    Add Pair
                  </Button>
                </VStack>
              )}

              {type === "Numerical" && (
                <>
                  <Number name="correctNumber" label="Correct Answer" />
                  <Number
                    name="tolerance"
                    label="Tolerance (+/-)"
                    helperText="Leave empty for exact match"
                  />
                </>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit isDisabled={isDisabled}>Save</Submit>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}

// This component must be inside ValidatedForm to use useFormContext
function OptionsWithCorrectAnswers({
  type,
  initialCorrectAnswers,
  initialOptions
}: {
  type: "MultipleChoice" | "MultipleAnswers";
  initialCorrectAnswers: string[];
  initialOptions: string[];
}) {
  const { getValues } = useFormContext();

  const [options, setOptions] = useState<string[]>(initialOptions);
  const [correctAnswer, setCorrectAnswer] = useState<string>(
    initialCorrectAnswers[0] ?? ""
  );
  const [correctAnswers, setCorrectAnswers] = useState<string[]>(
    initialCorrectAnswers
  );

  // Poll for option changes from the form
  useEffect(() => {
    const interval = setInterval(() => {
      const formData = getValues();
      const newOptions: string[] = [];
      let i = 0;
      while (formData.has(`options[${i}]`)) {
        const value = formData.get(`options[${i}]`) as string;
        if (value) newOptions.push(value);
        i++;
      }
      // Only update if options actually changed
      if (JSON.stringify(newOptions) !== JSON.stringify(options)) {
        setOptions(newOptions);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [getValues, options]);

  // Convert options array to select options format, filtering empty strings
  const answerOptions = useMemo(
    () =>
      options
        .filter((opt) => opt && opt.trim() !== "")
        .map((opt) => ({
          value: opt,
          label: opt
        })),
    [options]
  );

  // When options change, filter out any correct answers that are no longer valid
  useEffect(() => {
    const validOptions = options.filter((opt) => opt && opt.trim() !== "");
    if (type === "MultipleChoice") {
      if (correctAnswer && !validOptions.includes(correctAnswer)) {
        setCorrectAnswer("");
      }
    } else if (type === "MultipleAnswers") {
      const validAnswers = correctAnswers.filter((ans) =>
        validOptions.includes(ans)
      );
      if (validAnswers.length !== correctAnswers.length) {
        setCorrectAnswers(validAnswers);
      }
    }
  }, [options, type, correctAnswer, correctAnswers]);

  return (
    <>
      <ArrayInput name="options" label="Options" />

      {type === "MultipleChoice" && (
        <Select
          name="correctAnswers"
          label="Correct Answer"
          options={answerOptions}
          value={correctAnswer}
          onChange={(option) => {
            setCorrectAnswer(option?.value ?? "");
          }}
          helperText={
            answerOptions.length === 0 ? "Add options above first" : undefined
          }
        />
      )}

      {type === "MultipleAnswers" && (
        <MultiSelect
          name="correctAnswers"
          label="Correct Answers"
          options={answerOptions}
          value={correctAnswers}
          onChange={(selected) => {
            setCorrectAnswers(selected.map((s) => s.value));
          }}
          helperText={
            answerOptions.length === 0 ? "Add options above first" : undefined
          }
        />
      )}
    </>
  );
}
