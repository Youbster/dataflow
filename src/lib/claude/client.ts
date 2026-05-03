import OpenAI from "openai";

let openai: OpenAI | null = null;

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  openai ??= new OpenAI({ apiKey });
  return openai;
}

// gpt-4o-mini is 3-4x faster than gpt-4o for structured tasks like music
// curation — well within Vercel Hobby's 10-second function limit.
export const FAST_MODEL = "gpt-4o-mini";
