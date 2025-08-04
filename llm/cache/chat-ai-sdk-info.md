# Chat Function and AI SDK Information

## Chat Function Implementation

The Carbon system implements a chat function using the `@ai-sdk/anthropic` package located in `/packages/database/supabase/functions/chat/index.ts`.

### Key Components:

**Supabase Edge Function**: 
- Located at `/packages/database/supabase/functions/chat/index.ts`
- Uses `@ai-sdk/anthropic` to create an Anthropic model instance
- Configured with Claude 3.7 Sonnet model (`claude-3-7-sonnet-20250219`)
- Handles authentication via API key or Bearer token
- Supports both Carbon MCP API key and standard Supabase auth

**Frontend Agent Component**:
- Located at `/apps/erp/app/components/Agent/Agent.ee.tsx`
- Implements a chat interface with tool calling capabilities
- Uses `LanguageModelV1Prompt` type from the `ai` package
- Handles message history and conversation state

### API Structure:

```typescript
// Request body structure
{
  prompt: LanguageModelV1Prompt,
  mode: {
    type: "regular",
    tools: Array<{
      type: "function",
      name: string,
      description: string,
      parameters: object
    }>
  },
  inputFormat: "messages",
  temperature: number
}
```

## @ai-sdk/anthropic Package Usage

**Model Creation**:
```typescript
const model = createAnthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
})("claude-3-7-sonnet-20250219");
```

**Generation Call**:
```typescript
const result = await model.doGenerate(body);
```

The system uses the `LanguageModelV1CallOptions` type from the `ai` package for request validation.

## Stop/Finish Reasons

### Finish Reason Handling:

The chat system checks for `finishReason` in the response:

```typescript
if (result.finishReason === "tool-calls") {
  // Handle tool calls
  for await (const toolCall of result.toolCalls) {
    // Process each tool call
  }
}
```

### Common Finish Reasons:
- `"tool-calls"`: When the model wants to call tools/functions
- `"stop"`: Normal completion
- `"length"`: Hit token limit
- `"error"`: Error occurred during generation

### Tool Call Flow:
1. Model returns `finishReason: "tool-calls"` with `toolCalls` array
2. Frontend processes tool calls through MCP (Model Context Protocol)
3. Tool results are added back to conversation
4. New generation request is triggered to continue conversation

## Authentication and Headers

The chat function supports two authentication methods:
1. **Carbon MCP API Key**: Via `CARBON_MCP_API_KEY` environment variable
2. **Bearer Token**: Standard Supabase authentication with `Authorization: Bearer <token>` header

Required headers:
- `x-company-id`: Company identifier  
- `x-user-id`: User identifier (when using MCP API key)

## Error Handling

The system includes error handling for:
- `APICallError` from the AI SDK
- Authentication failures (401 Unauthorized)
- General exceptions with JSON error responses
- Proper CORS headers for cross-origin requests