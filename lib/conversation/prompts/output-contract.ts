/**
 * Prompt layer 3: the output contract and adaptive-outcome policy.
 * Lowest precedence in instruction terms, but the strictest in validation:
 * the server parses replies against this contract and degrades gracefully
 * when the model misses it.
 */

export function buildOutputContract(wantsTitle: boolean): string[] {
  const sections: string[] = []
  sections.push(
    `Respond with ONLY a single JSON object, no markdown, matching exactly, with keys in this order (message first):\n{"message": string, "intent": ${INTENTS_JSON}, "phase": "clarifying" | "ready", "skill": "app-icon" | "logo" | "og-image", "brief": {"concept": string, "style": string, "palette": string, "composition": string, "symbolism"?: string, "typography"?: string, "headline"?: string, "subline"?: string, "constraints"?: string[]} | null, "clarification": {"question": string, "suggestions"?: string[]} | null, "blocks"?: ${BLOCKS_JSON}${wantsTitle ? ', "title": string' : ""}}`
  )
  const rules = [
    "Rules for the JSON:",
    '- "intent" describes what kind of turn this is: "answer" (direct response), "clarify" (asking something), "explore" (proposing distinct directions), "compare" (weighing options), "critique" (assessing an existing visual), "prepare" (presenting a brief or proposal), "generate" (ready to generate), "refine" (adjusting an existing direction). Choose honestly; most turns are "answer".',
    '- "blocks" is OPTIONAL and rarely needed. Include a block only when its structure materially helps the user: use a "concept-comparison" block for genuinely distinct directions, a "critique" block only when you actually received an image to assess, a "palette" block only when concrete colors matter, a "typography" block only when typographic direction is the topic, and a "generation-proposal" block when proposing generation. Plain "message" text is always enough; do not decorate ordinary answers with blocks.',
    "- Block shapes: concept-comparison {type, options: [{title, premise, composition?, tradeoffs?}] (2-4 options)}; critique {type, basedOn: \"reference-image\" | \"generated-image\" | \"description\", strengths: [] (max 4), problems: [] (max 4), refinements: [] (max 4)}; palette {type, colors: [{hex: \"#rrggbb\", role}] (2-6), note?}; typography {type, directions: [{name, attitude, note?}] (2-3)}; generation-proposal {type, summary, suggestedCount?: 1 | 2 | 4}.",
    "- Never invent visual observations about an image you did not receive. Never fabricate palette values without design reasoning.",
    '- "skill" states which asset type this conversation is designing.',
    '- "phase" is "ready" only when the brief is complete enough to generate an asset from, and then "brief" must be fully populated. Otherwise use "clarifying". The brief stays in "brief" as structured state; whether a brief card is shown is decided by the intent ("prepare" or "generate").',
    '- You may include the brief while still "clarifying" when it reflects the current direction; keep revising it as the user answers.',
    '- "clarification" carries the one open question (when asking) and optional short answer suggestions; it must be null when "phase" is "ready".',
    '- "message" contains what the user reads: your consultation, reasoning summary, or the proposal. Never raw JSON inside "message".',
  ]
  if (wantsTitle) {
    rules.push(
      '- "title": a short session title for this conversation, in the user\'s language. Reflect the actual topic and intent. 3 to 7 words when practical, at most 60 characters. No quotation marks, no markdown, no trailing punctuation, no generic labels like "Design Conversation".'
    )
  }
  sections.push(rules.join("\n"))
  return sections
}

const INTENTS_JSON =
  '"answer" | "clarify" | "explore" | "compare" | "critique" | "prepare" | "generate" | "refine"'

const BLOCKS_JSON =
  'optional array of {type: "concept-comparison" | "critique" | "palette" | "typography" | "generation-proposal", ...}'
