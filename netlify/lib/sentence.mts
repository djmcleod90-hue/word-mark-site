// Checks whether a reader has used a word correctly in a sentence of their own.

import Anthropic from "@anthropic-ai/sdk";

export interface Verdict { correct: boolean; feedback: string }

export const LIMITS = { word: 60, definition: 400, sentence: 400, feedback: 400 };

/** Sentence checks need judgement more than speed, so they use a stronger model than card reading. */
export const sentenceModel = () => process.env.SENTENCE_MODEL || "claude-sonnet-5-5";
/** A reader's appeal gets the most careful review. */
export const appealModel = () => process.env.APPEAL_MODEL || "claude-opus-5-5";

const INSTRUCTIONS = `You check sentences for a vocabulary app. A reader has been learning a word and has written (or spoken) a sentence using it, to show they know what it means. Decide whether the sentence uses the word with its meaning.

Judge the word, not the world. You are only checking that the reader knows what the word means and how it is used. Never reject a sentence because you doubt a fact, a situation, a layout or an arrangement: boats, buildings, machines, places, people and lives all differ, and the reader knows their own. If the sentence would make sense with the word's meaning in some reasonable situation, it is correct. For example, for "adjacent", "Our kitchen is adjacent to the garage" is correct even if most kitchens aren't: the reader knows their own house.

Don't invent usage rules. Accept any use a good dictionary would recognise, including the forms listed there (many prepositions, for instance, take no "of"). Many words are rare, archaic, technical or slang; accept any use that fits the reader's own definition or an established meaning of the word.

Say it is correct when the word, or an ordinary form of it (plural, past tense, -ly and so on), is used with its meaning in a sentence that makes sense. Be generous about everything else: spelling or grammar slips elsewhere, casual or spoken phrasing, a missing capital or full stop, and simple sentences are all fine. Sentences are often spoken and turned into text, which can garble endings, so if the word is used with the right meaning but the wrong ending or form ("she asseverate" for "she asseverated"), count it as correct and mention the right form in the feedback.

Say it is not correct only when the word is missing; when it is only mentioned or defined ("Lugubrious means sad", "I learned the word lugubrious") rather than used; when it is clearly used with a different meaning; when it is used as a part of speech in a way that can't make sense; or when the sentence is nonsense.

When in doubt, it is correct. Telling a reader they are wrong when they are right is far worse than letting a borderline sentence pass.

Give the verdict, and feedback for the reader: at most 25 words, warm and specific, in Canadian spelling, addressed to the reader as "you". If correct, say briefly what works. If not, name exactly how the word itself is misused and hint how to fix it, without writing a full sentence for them. Talk about the sentence and the word, not about the check.`;

const APPEAL = `The reader believes an earlier check wrongly rejected this sentence. Review it afresh and carefully, as an experienced lexicographer would. The earlier check may well have been mistaken, for example by doubting facts about the world or by inventing a usage rule. Overturn it whenever the word is used with its meaning in a sentence that could make sense. Uphold it only if the word itself is clearly misused, and then explain precisely, and kindly, why.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "feedback"],
  properties: { correct: { type: "boolean" }, feedback: { type: "string" } },
};

class RefusedError extends Error {}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

export interface SentenceRequest {
  word: string;
  definition: string;
  sentence: string;
  /** The reader disputes an earlier rejection, whose feedback this is. */
  appealOf?: string;
}

export function prompt(request: SentenceRequest): { system: string; user: string; model: string } {
  let user = `Word: ${request.word}\nThe reader's definition: ${request.definition || "(none given)"}\nTheir sentence: ${request.sentence}`;
  if (request.appealOf !== undefined) user += `\nThe earlier check said: ${request.appealOf || "(no reason given)"}`;
  return {
    system: request.appealOf !== undefined ? `${INSTRUCTIONS}\n\n${APPEAL}` : INSTRUCTIONS,
    user,
    model: request.appealOf !== undefined ? appealModel() : sentenceModel(),
  };
}

export async function checkSentence(request: SentenceRequest): Promise<Verdict> {
  const { system, user, model } = prompt(request);
  const params = {
    model,
    // Thinking before the verdict, so the verdict isn't a snap judgement it then has to justify.
    max_tokens: 3000,
    thinking: { type: "enabled", budget_tokens: 2000 },
    system,
    messages: [{ role: "user" as const, content: user }],
    output_config: { format: { type: "json_schema" as const, schema: SCHEMA } },
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create(params as Anthropic.MessageCreateParamsNonStreaming);
      // A refusal isn't retried: repeating a declined request can get the model suspended for the account.
      if (response.stop_reason === "refusal") throw new RefusedError(`Request declined by ${model}`);
      const text = response.content.find((b) => b.type === "text");
      const parsed = JSON.parse(text?.type === "text" ? text.text : "{}") as Partial<Verdict>;
      if (typeof parsed.correct !== "boolean") throw new Error("No verdict in reply");
      console.log(`check-sentence ${request.appealOf !== undefined ? "appeal" : "check"} model=${model} correct=${parsed.correct}`);
      return { correct: parsed.correct, feedback: String(parsed.feedback ?? "").trim() };
    } catch (error) {
      lastError = error;
      if (error instanceof RefusedError || error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.BadRequestError
          || error instanceof Anthropic.PermissionDeniedError) break;
    }
  }
  throw lastError;
}

/** Trims and checks what the phone sent; null if it isn't usable. */
export function cleanRequest(body: any): SentenceRequest | null {
  const word = String(body?.word ?? "").trim();
  const definition = String(body?.definition ?? "").trim();
  const sentence = String(body?.sentence ?? "").replace(/\s+/g, " ").trim();
  if (!word || word.length > LIMITS.word) return null;
  if (sentence.length < 3 || sentence.length > LIMITS.sentence) return null;
  const request: SentenceRequest = { word, definition: definition.slice(0, LIMITS.definition), sentence };
  if (typeof body?.appealOf === "string") request.appealOf = body.appealOf.trim().slice(0, LIMITS.feedback);
  return request;
}
