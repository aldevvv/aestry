import { describe, expect, it } from "vitest"

import { buildConsultationTurns, parseConsultationReply } from "./consultation"
import type { Message } from "./types"

describe("parseConsultationReply", () => {
  it("parses a valid structured outcome", () => {
    const outcome = parseConsultationReply(
      JSON.stringify({
        message: "Here is my proposal.",
        phase: "ready",
        brief: {
          concept: "Compass + bracket",
          style: "Flat",
          palette: "Charcoal",
          composition: "Centered",
        },
        clarification: null,
      })
    )
    expect(outcome.structured).toBe(true)
    expect(outcome.phase).toBe("ready")
    expect(outcome.brief?.concept).toBe("Compass + bracket")
  })

  it("parses fenced JSON and nullish optional fields", () => {
    const outcome = parseConsultationReply(
      "```json\n" +
        JSON.stringify({
          message: "What is the product for?",
          phase: "clarifying",
          brief: null,
          clarification: { question: "What is the product for?", suggestions: null },
        }) +
        "\n```"
    )
    expect(outcome.structured).toBe(true)
    expect(outcome.phase).toBe("clarifying")
    expect(outcome.clarification?.suggestions).toBeUndefined()
    expect(outcome.brief).toBeUndefined()
  })

  it("never invents a brief when phase is ready but the brief is missing", () => {
    const outcome = parseConsultationReply(
      JSON.stringify({ message: "Ready!", phase: "ready", brief: null })
    )
    expect(outcome.structured).toBe(true)
    expect(outcome.phase).toBe("clarifying")
    expect(outcome.brief).toBeUndefined()
  })

  it("degrades malformed JSON to a plain clarifying outcome", () => {
    const outcome = parseConsultationReply("I would love to help! What is the app about?")
    expect(outcome.structured).toBe(false)
    expect(outcome.phase).toBe("clarifying")
    expect(outcome.brief).toBeUndefined()
    expect(outcome.message).toContain("What is the app about?")
  })

  it("recovers JSON embedded in prose", () => {
    const outcome = parseConsultationReply(
      'Sure — here is my structured answer:\n{"message":"Proposal ready.","phase":"ready","brief":{"concept":"c","style":"s","palette":"p","composition":"k"}}'
    )
    expect(outcome.structured).toBe(true)
    expect(outcome.phase).toBe("ready")
  })
})

function makeMessage(role: "user" | "assistant", type: string, extra?: object): Message {
  return {
    id: `${role}-${type}-${Math.random()}`,
    role,
    // Cast keeps the fixture builder small; production constructors build
    // real discriminated-union members.
    content: { type, ...(extra ?? {}) } as Message["content"],
    createdAt: new Date().toISOString(),
  }
}

describe("buildConsultationTurns", () => {
  it("keeps recent turns in chronological order", () => {
    const messages = [
      makeMessage("user", "text", { text: "first" }),
      makeMessage("assistant", "assistant-text", { text: "second" }),
      makeMessage("user", "text", { text: "third" }),
    ]
    const turns = buildConsultationTurns(messages)
    expect(turns.map((turn) => turn.text)).toEqual(["first", "second", "third"])
  })

  it("serializes briefs and skips empty content", () => {
    const messages = [
      makeMessage("assistant", "brief", { brief: { concept: "c", style: "s", palette: "p", composition: "k" } }),
      makeMessage("user", "text", { text: "refine it" }),
    ]
    const turns = buildConsultationTurns(messages)
    expect(turns).toHaveLength(2)
    expect(turns[0].text).toContain("Design brief proposed")
    expect(turns[1].text).toBe("refine it")
  })

  it("bounds history to the turn limit", () => {
    const messages = Array.from({ length: 40 }, (_, index) =>
      makeMessage(index % 2 === 0 ? "user" : "assistant", "text", { text: `turn ${index}` })
    )
    expect(buildConsultationTurns(messages, 10)).toHaveLength(10)
  })
})
