/**
 * Lua scripts for Redis rate limiting operations
 * These scripts ensure atomic operations for rate limiting
 */

/**
 * Fixed Window Rate Limiting
 *
 * Each request inside a fixed time window increases a counter.
 * Once the counter reaches the maximum, all further requests are rejected.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = max tokens (limit)
 * ARGV[2] = window size in ms
 * ARGV[3] = increment by (default 1)
 *
 * Returns: [current_count, limit]
 */
export const fixedWindowScript = `
local key         = KEYS[1]
local tokens      = tonumber(ARGV[1])
local window      = ARGV[2]
local incrementBy = tonumber(ARGV[3])

local r = redis.call("INCRBY", key, incrementBy)
if r == incrementBy then
  redis.call("PEXPIRE", key, window)
end

return {r, tokens}
`;

/**
 * Fixed Window Remaining Tokens
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = max tokens (limit)
 *
 * Returns: [remaining, limit]
 */
export const fixedWindowRemainingScript = `
local key = KEYS[1]
local tokens = tonumber(ARGV[1])

local value = redis.call('GET', key)
local usedTokens = 0
if value then
  usedTokens = tonumber(value)
end

return {tokens - usedTokens, tokens}
`;

/**
 * Sliding Window Rate Limiting
 *
 * Combines a weighted score between two windows for smoother rate limiting.
 * Prevents the boundary burst problem of fixed windows.
 *
 * KEYS[1] = current window key
 * KEYS[2] = previous window key
 * ARGV[1] = max tokens (limit)
 * ARGV[2] = current timestamp in ms
 * ARGV[3] = window size in ms
 * ARGV[4] = increment by (default 1)
 *
 * Returns: [remaining, limit] or [-1, limit] if blocked
 */
export const slidingWindowScript = `
local currentKey  = KEYS[1]
local previousKey = KEYS[2]
local tokens      = tonumber(ARGV[1])
local now         = tonumber(ARGV[2])
local window      = tonumber(ARGV[3])
local incrementBy = tonumber(ARGV[4])

local requestsInCurrentWindow = redis.call("GET", currentKey)
if requestsInCurrentWindow == false then
  requestsInCurrentWindow = 0
else
  requestsInCurrentWindow = tonumber(requestsInCurrentWindow)
end

local requestsInPreviousWindow = redis.call("GET", previousKey)
if requestsInPreviousWindow == false then
  requestsInPreviousWindow = 0
else
  requestsInPreviousWindow = tonumber(requestsInPreviousWindow)
end

local percentageInCurrent = (now % window) / window
requestsInPreviousWindow = math.floor((1 - percentageInCurrent) * requestsInPreviousWindow)

if incrementBy > 0 and requestsInPreviousWindow + requestsInCurrentWindow >= tokens then
  return {-1, tokens}
end

local newValue = redis.call("INCRBY", currentKey, incrementBy)
if newValue == incrementBy then
  redis.call("PEXPIRE", currentKey, window * 2 + 1000)
end

return {tokens - (newValue + requestsInPreviousWindow), tokens}
`;

/**
 * Sliding Window Remaining Tokens
 *
 * KEYS[1] = current window key
 * KEYS[2] = previous window key
 * ARGV[1] = max tokens (limit)
 * ARGV[2] = current timestamp in ms
 * ARGV[3] = window size in ms
 *
 * Returns: [remaining, limit]
 */
export const slidingWindowRemainingScript = `
local currentKey  = KEYS[1]
local previousKey = KEYS[2]
local tokens      = tonumber(ARGV[1])
local now         = tonumber(ARGV[2])
local window      = tonumber(ARGV[3])

local requestsInCurrentWindow = redis.call("GET", currentKey)
if requestsInCurrentWindow == false then
  requestsInCurrentWindow = 0
else
  requestsInCurrentWindow = tonumber(requestsInCurrentWindow)
end

local requestsInPreviousWindow = redis.call("GET", previousKey)
if requestsInPreviousWindow == false then
  requestsInPreviousWindow = 0
else
  requestsInPreviousWindow = tonumber(requestsInPreviousWindow)
end

local percentageInCurrent = (now % window) / window
requestsInPreviousWindow = math.floor((1 - percentageInCurrent) * requestsInPreviousWindow)

local usedTokens = requestsInPreviousWindow + requestsInCurrentWindow
return {tokens - usedTokens, tokens}
`;

/**
 * Sliding Window Refund — give back one token a successful `limit()` consumed
 *
 * Decrements the first of KEYS that holds a positive count, never below zero.
 * Current window first, then previous, so a refund that lands just after a
 * window boundary still returns the token to the window that took it.
 *
 * KEYS[1] = current window key
 * KEYS[2] = previous window key
 *
 * Returns: 1 when a token was returned, 0 when there was nothing to return
 */
export const slidingWindowRefundScript = `
for _, key in ipairs(KEYS) do
  local value = redis.call("GET", key)
  if value and tonumber(value) > 0 then
    redis.call("DECRBY", key, 1)
    return 1
  end
end
return 0
`;

/**
 * Token Bucket Rate Limiting
 *
 * A bucket filled with tokens that refills at a constant rate.
 * Allows bursts up to the bucket size while maintaining an average rate.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = max tokens (bucket size)
 * ARGV[2] = refill interval in ms
 * ARGV[3] = refill rate (tokens per interval)
 * ARGV[4] = current timestamp in ms
 * ARGV[5] = tokens to consume (default 1)
 *
 * Returns: [remaining, reset_timestamp, limit] or [-1, reset_timestamp, limit] if blocked
 */
export const tokenBucketScript = `
local key         = KEYS[1]
local maxTokens   = tonumber(ARGV[1])
local interval    = tonumber(ARGV[2])
local refillRate  = tonumber(ARGV[3])
local now         = tonumber(ARGV[4])
local incrementBy = tonumber(ARGV[5])

local bucket = redis.call("HMGET", key, "refilledAt", "tokens")

local refilledAt
local tokens

if bucket[1] == false then
  refilledAt = now
  tokens = maxTokens
else
  refilledAt = tonumber(bucket[1])
  tokens = tonumber(bucket[2])
end

if now >= refilledAt + interval then
  local numRefills = math.floor((now - refilledAt) / interval)
  tokens = math.min(maxTokens, tokens + numRefills * refillRate)
  refilledAt = refilledAt + numRefills * interval
end

if tokens == 0 and incrementBy > 0 then
  return {-1, refilledAt + interval, maxTokens}
end

local remaining = tokens - incrementBy
local expireAt = math.ceil(((maxTokens - remaining) / refillRate)) * interval

redis.call("HSET", key, "refilledAt", refilledAt, "tokens", remaining)

if expireAt > 0 then
  redis.call("PEXPIRE", key, expireAt)
end

return {remaining, refilledAt + interval, maxTokens}
`;

/**
 * Token Bucket Remaining Tokens
 *
 * KEYS[1] = bucket key
 * ARGV[1] = max tokens (bucket size)
 * ARGV[2] = refill interval in ms
 * ARGV[3] = refill rate (tokens per interval)
 * ARGV[4] = current timestamp in ms
 *
 * Returns: [remaining, reset_timestamp, limit]
 */
export const tokenBucketRemainingScript = `
local key         = KEYS[1]
local maxTokens   = tonumber(ARGV[1])
local interval    = tonumber(ARGV[2])
local refillRate  = tonumber(ARGV[3])
local now         = tonumber(ARGV[4])

local bucket = redis.call("HMGET", key, "refilledAt", "tokens")

if bucket[1] == false then
  return {maxTokens, now + interval, maxTokens}
end

local refilledAt = tonumber(bucket[1])
local tokens = tonumber(bucket[2])

if now >= refilledAt + interval then
  local numRefills = math.floor((now - refilledAt) / interval)
  tokens = math.min(maxTokens, tokens + numRefills * refillRate)
end

return {tokens, refilledAt + interval, maxTokens}
`;
