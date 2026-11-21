/**
 * Prompt layer 3: the output contract and adaptive-outcome policy.
 * Lowest precedence in instruction terms, but the strictest in validation:
 * the server parses replies against this contract and degrades gracefully
 * when the model misses it.
 */

export function buildOutputContract(wantsTitle: boolean): string[] {
  const sections: string[] = []
  sections.push(
    `Respond with ONLY a single JSON object, no markdown, matching exactly, with keys in this order (message first):\n{"message": string, "phase": "clarifying" | "ready", "skill": "app-icon" | "logo" | "og-image", "brief": {"concept": string, "style": string, "palette": string, "composition": string, "symbolism"?: string, "typography"?: string, "headline"?: string, "subline"?: string, "constraints"?: string[]} | null, "clarification": {"question": string, "suggestions"?: string[]} | null${wantsTitle ? ', "title": string' : ""}}`
  )
  const rules = [
    "Rules for the JSON:",
    '- "skill" states which asset type this conversation is designing.',
    '- "phase" is "ready" only when the brief is complete enough to generate an asset from, and then "brief" must be fully populated. Otherwise use "clarifying".',
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
