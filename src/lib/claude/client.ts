import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// gpt-4o-mini is 3-4x faster than gpt-4o for structured tasks like music
// curation — well within Vercel Hobby's 10-second function limit.
export const FAST_MODEL = "gpt-4o-mini";
