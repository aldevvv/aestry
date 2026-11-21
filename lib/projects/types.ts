/**
 * Projects: local-first, first-class design domains that scope
 * conversations and reusable design context. Not folders of chat links —
 * a Project carries user-authored instructions that inform consultation
 * while never overriding security or authorization boundaries.
 */

export const PROJECT_NAME_MAX = 60
export const PROJECT_DESCRIPTION_MAX = 300
export const PROJECT_INSTRUCTIONS_MAX = 2_000

export type DesignProject = {
  id: string
  name: string
  description?: string
  /**
   * User-authored standing guidance for consultations inside this Project.
   * Treated as context with explicit, bounded precedence — never as an
   * instruction channel over server authorization, credentials, security
   * policies, or generation approval.
   */
  instructions?: string
  createdAt: string
  updatedAt: string
}

export function sanitizeProjectName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const cleaned = raw.replace(/\s+/g, " ").trim()
  if (!cleaned) return undefined
  return Array.from(cleaned)
    .slice(0, PROJECT_NAME_MAX)
    .join("")
    .trimEnd()
}

export function sanitizeProjectText(
  raw: unknown,
  max: number
): string | undefined {
  if (typeof raw !== "string") return undefined
  const cleaned = raw.trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, max)
}
