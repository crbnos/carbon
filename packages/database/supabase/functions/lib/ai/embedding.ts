// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const model = new Supabase.ai.Session("gte-small");
/**
 * Generates an embedding for the given text.
 */

/**
 * Sanitizes text for embedding generation.
 * Removes null bytes and control characters that can cause issues with HTTP headers.
 */
function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "") // Remove null bytes
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // Replace control characters with spaces
    .trim()
    .replace(/\s+/g, " "); // Normalize whitespace
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const sanitized = sanitizeText(text);

  if (!sanitized) {
    throw new Error("Cannot generate embedding for empty text");
  }

  console.log("Generating embedding for text:", {
    original: text.substring(0, 100),
    sanitized: sanitized.substring(0, 100),
    length: sanitized.length,
  });

  const embedding = await model.run(sanitized, {
    mean_pool: true,
    normalize: true,
  });

  console.log("Generated embedding:", {
    length: (embedding as number[]).length,
    first5: (embedding as number[]).slice(0, 5),
  });

  return embedding as number[];
}
