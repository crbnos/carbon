import { convertToModelMessages, modelMessageSchema, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactEarlierToolOutputs } from "./agent.history";

const page = "x".repeat(20_000);

const user = (text: string): UIMessage => ({
  id: text,
  role: "user",
  parts: [{ type: "text", text }]
});

const assistantThatRead = (id: string): UIMessage =>
  ({
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-search_docs",
        toolCallId: `${id}-s`,
        state: "output-available",
        input: { query: "batching" },
        output: [
          {
            title: "Operation batching",
            url: "https://docs.carbon.ms/docs/reference/batching",
            snippet: "Operation batching groups unstarted operations…"
          },
          {
            title: "Operation batching",
            section: "Building a batch",
            url: "https://docs.carbon.ms/docs/reference/batching#building-a-batch",
            snippet: "A batch groups operations…"
          }
        ]
      },
      {
        type: "tool-read_doc",
        toolCallId: `${id}-r`,
        state: "output-available",
        input: { url: "https://docs.carbon.ms/docs/reference/batching" },
        output: {
          url: "https://docs.carbon.ms/docs/reference/batching",
          content: page
        }
      },
      { type: "text", text: "Batching groups operations." }
    ]
  }) as UIMessage;

describe("compactEarlierToolOutputs", () => {
  it("drops the text of doc results from earlier turns but keeps their urls", () => {
    const [, earlier] = compactEarlierToolOutputs([
      user("what is batching"),
      assistantThatRead("a1"),
      user("and how do I start one")
    ]);
    const [search, read, text] = earlier!.parts as unknown as Array<{
      output?: unknown;
      text?: string;
    }>;

    expect(read!.output).toEqual({
      url: "https://docs.carbon.ms/docs/reference/batching",
      note: "Read in an earlier turn; read_doc again for the text."
    });
    expect(search!.output).toEqual([
      {
        title: "Operation batching",
        url: "https://docs.carbon.ms/docs/reference/batching"
      },
      {
        title: "Operation batching",
        section: "Building a batch",
        url: "https://docs.carbon.ms/docs/reference/batching#building-a-batch"
      }
    ]);
    expect(text!.text).toBe("Batching groups operations.");
    expect(JSON.stringify(earlier).length).toBeLessThan(1_000);
  });

  it("produces a prompt the AI SDK accepts, including an intro hit with no section", () => {
    const compacted = compactEarlierToolOutputs([
      user("what is batching"),
      assistantThatRead("a1"),
      user("and how do I start one")
    ]);
    const prompt = convertToModelMessages(compacted);
    expect(modelMessageSchema.array().safeParse(prompt).success).toBe(true);
  });

  it("leaves the current turn untouched", () => {
    const messages = [user("what is batching"), assistantThatRead("a1")];
    expect(compactEarlierToolOutputs(messages)).toEqual(messages);
  });
});
