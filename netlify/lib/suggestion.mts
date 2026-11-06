// A reader's suggested change to one of Word-Mark's definitions: checked, then kept and emailed for review.

export const REASONS: Record<string, string> = {
  wrong: "It's wrong",
  missing: "It's missing a meaning",
  unclear: "It's hard to understand",
  typo: "It has a typo or grammar mistake",
  offensive: "It's offensive",
  other: "Something else",
};

export interface Suggestion {
  word: string;
  definition: string;
  reason: string;
  note: string;
}

/** The fields if they're all there and a sensible size; the note is optional. */
export function cleanSuggestion(body: unknown): Suggestion | null {
  const { word, definition, reason, note } = (body ?? {}) as Record<string, unknown>;
  if (typeof word !== "string" || typeof definition !== "string" || typeof reason !== "string") return null;
  if (note !== undefined && typeof note !== "string") return null;
  const clean = { word: word.trim(), definition: definition.trim(), reason, note: (note ?? "").trim() };
  if (!clean.word || clean.word.length > 80 || !clean.definition || clean.definition.length > 600) return null;
  if (!Object.hasOwn(REASONS, clean.reason) || clean.note.length > 1000) return null;
  return clean;
}

/** The submission that Netlify Forms emails to Word-Mark; the fields match the form in contact.html. */
export function formBody(suggestion: Suggestion): string {
  return new URLSearchParams({
    "form-name": "definition-suggestion",
    word: suggestion.word,
    definition: suggestion.definition,
    reason: REASONS[suggestion.reason],
    note: suggestion.note,
  }).toString();
}
