// Asks Claude to transcribe one side of a bookmark from a photo of the card.

import Anthropic from "@anthropic-ai/sdk";

export interface Entry { word: string; definition: string }

/** Which model reads cards. Change READING_MODEL in Netlify's settings to switch, no app update needed. */
export const readingModel = () => process.env.READING_MODEL || "claude-haiku-4-5";

const PRICES: Record<string, [number, number]> = { // US$ per million input / output tokens
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
};

export const INSTRUCTIONS = `You transcribe handwriting from a photo of one side of a Word-Mark vocabulary bookmark. Each entry is a word the reader is learning, usually followed by a colon and the definition they wrote, over one or two lines (occasionally more). Number the entries 1, 2, 3… from the top.

Transcribe exactly what is written. Do not improve, complete or replace the writer's definition with dictionary wording, and keep their abbreviations and punctuation.

The words being learned are often rare, archaic, obsolete or slang, and many are not in modern dictionaries. Never change a word into a more common or familiar word that looks similar — if the letters spell an unusual word, write those letters, even if you don't recognise it. For example, if "beazel" is written, write "beazel", not "bezel". Only change a letter when the handwriting itself clearly shows a different one.

A rough reading from the phone's text recognition is included only as a hint for letters you can't make out. If something is illegible, give your best reading.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "definition"],
        properties: { word: { type: "string" }, definition: { type: "string" } },
      },
    },
  },
};

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from Netlify's environment

export async function transcribe(jpegBase64: string, draft: Entry[]): Promise<{ entries: Entry[]; model: string; costCents: number }> {
  const model = readingModel();
  let hint = "The phone's rough reading, in order (may have missing, merged or misread entries):\n";
  draft.slice(0, 30).forEach((e, i) => { hint += `${i + 1}. ${e.word.slice(0, 80)}: ${e.definition.slice(0, 400)}\n`; });
  hint += "\nTranscribe every handwritten entry on this side of the bookmark, top to bottom. Skip the printed title, quote, footer and anything in the narrow margin column beside the holes.";

  const request = {
    model,
    max_tokens: 4000,
    system: INSTRUCTIONS,
    messages: [{
      role: "user" as const,
      content: [
        { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: jpegBase64 } },
        { type: "text" as const, text: hint },
      ],
    }],
    output_config: {
      format: { type: "json_schema" as const, schema: SCHEMA },
      // Sonnet 5.5 thinks by default; low effort is plenty for transcription. Haiku 4.5 doesn't take this setting.
      ...(model.startsWith("claude-sonnet-5") ? { effort: "low" as const } : {}),
    },
  };

  // Requests occasionally fail or come back unusable; one retry covers most of those.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create(request as Anthropic.MessageCreateParamsNonStreaming);
      if (response.stop_reason === "refusal") throw new Error("Request declined");
      const text = response.content.find((b) => b.type === "text");
      const parsed = JSON.parse(text?.type === "text" ? text.text : "") as { entries?: Entry[] };
      const entries = (parsed.entries ?? [])
        .map((e) => ({ word: String(e.word ?? "").replace(/^[\s:]+|[\s:]+$/g, ""), definition: String(e.definition ?? "").trim() }))
        .filter((e) => e.word || e.definition);
      if (entries.length === 0) throw new Error("No entries in reply");
      const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
      const costCents = ((response.usage.input_tokens * inPrice + response.usage.output_tokens * outPrice) / 1_000_000) * 100;
      return { entries, model, costCents };
    } catch (error) {
      lastError = error;
      // A bad key or malformed request won't get better on retry.
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.BadRequestError) break;
    }
  }
  throw lastError;
}
