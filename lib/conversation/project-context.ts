import { z } from "zod"

/**
 * Minimal, safe public GitHub project context. Only github.com repository
 * URLs are recognized; the server enforces the same policy and never
 * fetches arbitrary destinations.
 */

const GITHUB_URL_PATTERN =
  /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?(\?.*)?(#.*)?$/i

export function detectGitHubUrl(text: string): string | null {
  const match = GITHUB_URL_PATTERN.exec(text.trim())
  if (!match) return null
  const [, owner, repo] = match
  return `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}`
}

const projectContextResponseSchema = z.object({
  context: z
    .object({
      name: z.string(),
      summary: z.string(),
    })
    .optional(),
  error: z.string().optional(),
})

/**
 * Returns bounded, read-only context about a public GitHub repository, or
 * null when it cannot be fetched (non-blocking for the conversation).
 */
export async function fetchProjectContext(
  url: string
): Promise<{ name: string; summary: string } | null> {
  try {
    const response = await fetch("/api/project-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(20_000),
    })
    const data: unknown = await response.json().catch(() => null)
    const parsed = projectContextResponseSchema.safeParse(data)
    if (!response.ok || !parsed.success || !parsed.data.context) {
      return null
    }
    return parsed.data.context
  } catch {
    return null
  }
}
