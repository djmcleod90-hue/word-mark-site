// Checks whether a reader has used a word correctly in a sentence of their own.

import Anthropic from "@anthropic-ai/sdk";
import { readingModel } from "./transcribe.mts";

export interface Verdict { correct: boolean; feedback: string }

export const LIMITS = { word: 60, definition: 400, sentence: 400 };

const INSTRUCTIONS = `You check sentences for a vocabulary app. A reader has been learning a word and has written (or spoken) a sentence using it, to show they know what it means. Decide whether the sentence uses the word correctly.

Say it is correct when the word, or an ordinary form of it (plural, past tense, -ly and so on), is used with its meaning in a sentence that makes sense. Be generous about everything else: spelling or grammar slips elsewhere, casual or spoken phrasing, a missing capital or full stop, and simple sentences are all fine. The reader's own definition is given; many words are rare, archaic or slang, so accept any use that fits that definition or an established meaning of the word.

This tests whether the reader knows the word's meaning, and sentences are often spoken and turned into text, which can garble endings. So if the word is used with the right meaning but the wrong ending or form ("she asseverate" for "she asseverated"), count it as correct and mention the right form in the feedback.

Say it is not correct when the word is missing; when it is only mentioned or defined ("Lugubrious means sad", "I learned the word lugubrious") rather than used; when it is used with the wrong meaning or as the wrong part of speech in a way that doesn't make sense; or when the sentence is nonsense.

Feedback is at most 25 words, warm and specific, in Canadian spelling, addressed to the reader as "you". If correct, say briefly what works. If not, say what's off and hint how to fix it, without writing a full sentence for them. Never mention AI, models or grading.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "feedback"],
  properties: { correct: { type: "boolean" }, feedback: { type: "string" } },
};

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

export async function checkSentence(word: string, definition: string, sentence: string): Promise<Verdict> {
  const request = {
    model: readingModel(),
    max_tokens: 300,
    system: INSTRUCTIONS,
    messages: [{
      role: "user" as const,
      content: `Word: ${word}\nThe reader's definition: ${definition || "(none given)"}\nTheir sentence: ${sentence}`,
    }],
    output_config: { format: { type: "json_schema" as const, schema: SCHEMA } },
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create(request as Anthropic.MessageCreateParamsNonStreaming);
      if (response.stop_reason === "refusal") throw new Error("Request declined");
      const text = response.content.find((b) => b.type === "text");
      const parsed = JSON.parse(text?.type === "text" ? text.text : "{}") as Partial<Verdict>;
      if (typeof parsed.correct !== "boolean") throw new Error("No verdict in reply");
      return { correct: parsed.correct, feedback: String(parsed.feedback ?? "").trim() };
    } catch (error) {
      lastError = error;
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.BadRequestError) break;
    }
  }
  throw lastError;
}

/** Trims and checks what the phone sent; null if it isn't usable. */
export function cleanRequest(body: any): { word: string; definition: string; sentence: string } | null {
  const word = String(body?.word ?? "").trim();
  const definition = String(body?.definition ?? "").trim();
  const sentence = String(body?.sentence ?? "").replace(/\s+/g, " ").trim();
  if (!word || word.length > LIMITS.word) return null;
  if (sentence.length < 3 || sentence.length > LIMITS.sentence) return null;
  return { word, definition: definition.slice(0, LIMITS.definition), sentence };
}
