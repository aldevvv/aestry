import { NextResponse } from "next/server"
import { z } from "zod"

import { ProviderRequestError } from "@/lib/providers/types"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody } from "@/lib/server/limits"
import { safeFetchJson } from "@/lib/server/outbound"

/**
 * POST /api/project-context — bounded, read-only context gathering for
 * public GitHub repositories. Only github.com repository URLs are accepted;
 * the response is trimmed to a small excerpt for consultation context.
 */

const bodySchema = z.object({
  url: z.string().trim().min(1).max(300),
})

const GITHUB_REPO_URL =
  /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/i
const MAX_README_CHARS = 6_000

function repoSlug(url: string): { owner: string; repo: string } | null {
  const match = GITHUB_REPO_URL.exec(url)
  if (!match) return null
  const [, owner, repo] = match
  return { owner, repo: repo.replace(/\.git$/i, "") }
}

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, 4_096)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = bodySchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const slug = repoSlug(parsed.data.url)
  if (!slug) {
    return NextResponse.json(
      { error: "Only public github.com repository URLs are supported." },
      { status: 400 }
    )
  }

  try {
    const repoResult = await safeFetchJson<Record<string, unknown>>(
      `https://api.github.com/repos/${slug.owner}/${slug.repo}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        timeoutMs: 15_000,
      }
    )
    if (!repoResult.ok) {
      if (repoResult.response.status === 404) {
        return NextResponse.json(
          { error: "That repository could not be found or is private." },
          { status: 404 }
        )
      }
      if (repoResult.response.status === 403) {
        return NextResponse.json(
          { error: "GitHub API rate limit reached — try again later." },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { error: "Could not read the repository." },
        { status: 502 }
      )
    }

    const repo = repoResult.data
    const name =
      typeof repo.name === "string" ? repo.name : `${slug.owner}/${slug.repo}`
    const description = typeof repo.description === "string" ? repo.description : ""
    const language = typeof repo.language === "string" ? repo.language : undefined
    const topics = Array.isArray(repo.topics)
      ? repo.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 8)
      : []
    const homepage = typeof repo.homepage === "string" && repo.homepage.startsWith("http")
      ? repo.homepage
      : undefined

    let readmeExcerpt = ""
    const readmeResult = await safeFetchJson<string>(
      `https://api.github.com/repos/${slug.owner}/${slug.repo}/readme`,
      {
        headers: {
          Accept: "application/vnd.github.raw+json",
        },
        timeoutMs: 15_000,
        maxBytes: 512 * 1024,
      }
    ).catch(() => null)
    if (readmeResult && readmeResult.ok) {
      const rawReadme =
        typeof readmeResult.data === "string"
          ? readmeResult.data
          : JSON.stringify(readmeResult.data)
      // Strip markdown noise lightly; the excerpt is reference material only.
      const cleaned = rawReadme
        .replace(/<[^>]+>/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim()
      readmeExcerpt =
        cleaned.length > MAX_README_CHARS
          ? `${cleaned.slice(0, MAX_README_CHARS)}… [truncated]`
          : cleaned
    }

    const summaryParts = [
      description,
      language ? `Primary language: ${language}.` : "",
      topics.length > 0 ? `Topics: ${topics.join(", ")}.` : "",
      homepage ? `Website: ${homepage}.` : "",
      readmeExcerpt ? `README excerpt: ${readmeExcerpt}` : "",
    ].filter(Boolean)

    return NextResponse.json({
      context: {
        name,
        summary: summaryParts.join("\n") || "No public description available.",
      },
    })
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: "Could not fetch project context." },
      { status: 502 }
    )
  }
}
