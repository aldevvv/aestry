"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowDownIcon } from "lucide-react"

import {
  Composer,
} from "@/components/conversation/composer"
import { MessageList } from "@/components/conversation/message-list"
import { cacheImageUrl } from "@/components/conversation/image-url"
import { Button } from "@/components/ui/button"
import { useMounted } from "@/hooks/use-mounted"
import {
  buildConsultationTurns,
} from "@/lib/conversation/consultation"
import {
  streamChat,
} from "@/lib/conversation/streaming"
import { ThinkingOrbIndicator, WelcomeOrb } from "@/components/thinking-indicator"
import {
  ESTIMATED_TOKENS_PER_IMAGE,
  estimateTokens,
  shouldAutoCompact,
} from "@/lib/conversation/compaction"
import { detectGitHubUrl, fetchProjectContext } from "@/lib/conversation/project-context"
import {
  loadImageBlob,
  saveGeneratedAsset,
  saveImageBlob,
} from "@/lib/conversation/persistence"
import {
  selectActiveConversation,
  useConversations,
} from "@/lib/conversation/store"
import {
  selectedModelContextWindow,
  useProviders,
} from "@/lib/provider-store"
import {
  isSkillId,
} from "@/lib/skills/registry"
import type {
  GenerationRecord,
  StoredImageRef,
} from "@/lib/conversation/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function fileToBase64(
  file: File
): Promise<{ mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const separator = result.indexOf(",")
      resolve({
        mimeType: file.type || "image/png",
        data: result.slice(separator + 1),
      })
    }
    reader.onerror = () => reject(new Error("Could not read the image"))
    reader.readAsDataURL(file)
  })
}

const WELCOME_SUGGESTIONS: string[] = [
  "Design a modern app icon for a productivity application.",
  "Create a minimal logo for my developer tool.",
  "Create an OG image for my open-source project.",
]

export function ConversationWorkspace({
  conversationId,
}: {
  conversationId?: string
}) {
  const router = useRouter()
  const mounted = useMounted()
  const conversation = useConversations(selectActiveConversation)
  const notFoundIds = useConversations((state) => state.notFoundIds)
  const storageWarning = useConversations((state) => state.storageWarning)
  const consultation = useProviders((state) => state.selections.consultation)
  const generation = useProviders((state) => state.selections.generation)
  const refreshStatus = useProviders((state) => state.refreshStatus)

  // Server-side provider statuses gate the composer and role selects.
  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const [busy, setBusy] = React.useState(false)
  const [compacting, setCompacting] = React.useState(false)
  const [streamingText, setStreamingText] = React.useState<string | null>(null)
  const missing =
    mounted &&
    Boolean(conversationId) &&
    !conversation &&
    notFoundIds.includes(conversationId ?? "")
  const [pendingReferences, setPendingReferences] = React.useState<
    StoredImageRef[]
  >([])
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [nearBottom, setNearBottom] = React.useState(true)

  // Route <-> conversation synchronization.
  React.useEffect(() => {
    const state = useConversations.getState()
    if (conversationId) {
      if (state.conversations[conversationId]) {
        state.setActive(conversationId)
      } else {
        void state.restoreFromStorage(conversationId)
      }
    } else {
      state.setActive(null)
    }
  }, [conversationId])

  // Follow new messages only when the user is near the bottom.
  const scrollToBottom = React.useCallback((smooth: boolean) => {
    const container = scrollRef.current
    if (!container) return
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth && !prefersReducedMotion ? "smooth" : "auto",
    })
  }, [])

  const handleScroll = React.useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    setNearBottom(distance < 120)
  }, [])

  React.useEffect(() => {
    if (nearBottom) {
      scrollToBottom(false)
    }
    // Re-anchor when a new message lands while already at the bottom.
  }, [conversation?.messages.length, nearBottom, scrollToBottom])

  const runCompaction = React.useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!consultation) return false
      setCompacting(true)
      try {
        const latest = useConversations.getState().conversations[conversationId]
        if (!latest || latest.messages.length === 0) return false
        const history = buildConsultationTurns(
          latest.messages,
          80,
          60_000,
          latest.compaction?.upToMessageId
        )
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: consultation.providerId,
            model: consultation.model,
            skillId: latest.skillId,
            history,
            mode: "compact",
          }),
          signal: AbortSignal.timeout(180_000),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const message =
            isRecord(data) && typeof data.error === "string"
              ? data.error
              : "Compaction failed."
          toast.error(message)
          return false
        }
        if (
          !isRecord(data) ||
          !isRecord(data.compaction) ||
          typeof data.compaction.summary !== "string"
        ) {
          toast.error("Compaction could not produce a reliable summary.")
          return false
        }
        const lastMessage = latest.messages[latest.messages.length - 1]
        if (!lastMessage) return false
        const decisions =
          isRecord(data.compaction) && Array.isArray(data.compaction.decisions)
            ? data.compaction.decisions.filter(
                (decision): decision is string => typeof decision === "string"
              )
            : undefined
        useConversations.getState().setCompaction(conversationId, {
          summary: data.compaction.summary,
          decisions,
          upToMessageId: lastMessage.id,
          at: new Date().toISOString(),
        })
        if (
          isRecord(data) &&
          isRecord(data.usage) &&
          typeof data.usage.promptTokens === "number"
        ) {
          useConversations
            .getState()
            .setContextTokens(conversationId, data.usage.promptTokens)
        }
        useConversations.getState().appendMessage(conversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: {
            type: "context",
            title: "Conversation compacted",
            summary:
              "Earlier context was summarized so the consultation stays within the model's window. The full history remains below.",
          },
          createdAt: new Date().toISOString(),
        })
        return true
      } catch (error) {
        toast.error(
          error instanceof DOMException && error.name === "TimeoutError"
            ? "Compaction timed out."
            : "Compaction could not reach the server."
        )
        return false
      } finally {
        setCompacting(false)
      }
    },
    [consultation]
  )

  /**
   * Second stage of the compaction decision: the cheap client-side estimate
   * decides when to ask, an exact server-side countTokens decides whether a
   * billable compaction round-trip is actually necessary. When counting is
   * unavailable the estimate is trusted.
   */
  const confirmCompactionNeeded = React.useCallback(
    async (options: {
      providerId: "gemini" | "vertex"
      model: string
      skillId: "app-icon" | "logo" | "og-image"
      brief: unknown
      history: Array<{ role: "user" | "assistant"; text: string }>
      projectContext?: string
      estimateSaysCompact: boolean
      window: number | undefined
    }): Promise<boolean> => {
      if (!options.estimateSaysCompact) return false
      try {
        const response = await fetch("/api/chat/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: options.providerId,
            model: options.model,
            skillId: options.skillId,
            brief: options.brief,
            history: options.history,
            projectContext: options.projectContext,
          }),
          signal: AbortSignal.timeout(30_000),
        })
        const data: unknown = await response.json().catch(() => null)
        if (
          response.ok &&
          isRecord(data) &&
          data.available === true &&
          typeof data.totalTokens === "number"
        ) {
          return shouldAutoCompact(data.totalTokens, options.window)
        }
      } catch {
        // Counting is an enhancement; fall back to the estimate.
      }
      return true
    },
    []
  )

  const handleSend = React.useCallback(
    async (text: string, files: File[]) => {
      if (!consultation || busy) return
      setBusy(true)
      try {
        let target = conversation
        if (!target) {
          // The consultant assigns the asset skill from the request; the
          // conversation starts neutral until then.
          target = useConversations.getState().createConversation("app-icon")
          router.push(`/chat/${target.id}`)
        }

        // Auto-compact BEFORE the new message is appended, when the context
        // approaches the consultation model's window. The compaction point
        // must land before this message, otherwise the message would be
        // summarized away and never reach the model.
        const consultationModelWindow = selectedModelContextWindow(
          useProviders.getState(),
          "consultation"
        )
        const projectedTokens =
          (target.contextTokens ?? 0) +
          estimateTokens(text) +
          files.length * ESTIMATED_TOKENS_PER_IMAGE
        const estimateSaysCompact = shouldAutoCompact(
          projectedTokens,
          consultationModelWindow
        )
        const latestBeforeSend =
          useConversations.getState().conversations[target.id]
        const prospectiveHistory = buildConsultationTurns(
          latestBeforeSend?.messages ?? [],
          16,
          16_000,
          latestBeforeSend?.compaction?.upToMessageId
        )
        prospectiveHistory.push({ role: "user", text })
        const needsCompaction = await confirmCompactionNeeded({
          providerId: consultation.providerId,
          model: consultation.model,
          skillId: target.skillId,
          brief: target.brief,
          history: prospectiveHistory,
          projectContext: target.projectContext?.summary,
          estimateSaysCompact,
          window: consultationModelWindow,
        })
        if (needsCompaction) {
          const compacted = await runCompaction(target.id)
          if (!compacted) {
            toast.warning(
              "Auto-compaction failed — the next request may exceed the model's context window."
            )
          }
        }

        const referenceImages: Array<{ mimeType: string; data: string }> = []
        const storedReferences: StoredImageRef[] = []
        for (const file of files) {
          const imageId = crypto.randomUUID()
          const mimeType = file.type || "image/png"
          await saveImageBlob({
            id: imageId,
            conversationId: target.id,
            role: "reference",
            mimeType,
            blob: file,
          })
          storedReferences.push({ imageId, mimeType })
          referenceImages.push(await fileToBase64(file))
        }

        useConversations.getState().appendMessage(target.id, {
          id: crypto.randomUUID(),
          role: "user",
          content: {
            type: "text",
            text,
            references: storedReferences.length > 0 ? storedReferences : undefined,
          },
          createdAt: new Date().toISOString(),
        })
        setNearBottom(true)

        // Minimal, safe project context for public GitHub repositories.
        const githubUrl = detectGitHubUrl(text)
        let projectContextSummary = target.projectContext?.summary
        if (githubUrl && !target.projectContext) {
          const context = await fetchProjectContext(githubUrl)
          if (context) {
            useConversations.getState().setProjectContext(target.id, {
              url: githubUrl,
              name: context.name,
              summary: context.summary,
            })
            useConversations.getState().appendMessage(target.id, {
              id: crypto.randomUUID(),
              role: "assistant",
              content: {
                type: "context",
                title: `Project context: ${context.name}`,
                summary: context.summary,
              },
              createdAt: new Date().toISOString(),
            })
            projectContextSummary = context.summary
          } else {
            toast.info("Could not fetch project context — continuing without it.")
          }
        }

        useConversations.getState().setPhase(target.id, "consulting")
        const latest =
          useConversations.getState().conversations[target.id]
        const history = buildConsultationTurns(
          latest?.messages ?? [],
          16,
          16_000,
          latest?.compaction?.upToMessageId
        )
        // Streamed consultation: the server extracts the user-facing message,
        // so deltas render live; the validated outcome arrives at the end.
        let streaming = ""
        const result = await streamChat(
          {
            providerId: consultation.providerId,
            model: consultation.model,
            skillId: target.skillId,
            brief: target.brief,
            history,
            referenceImages:
              referenceImages.length > 0 ? referenceImages : undefined,
            projectContext: projectContextSummary,
          },
          {
            onDelta: (delta) => {
              streaming += delta
              setStreamingText(streaming)
            },
            onUsage: (promptTokens) => {
              // Authoritative context usage for the pie indicator.
              useConversations
                .getState()
                .setContextTokens(target.id, promptTokens)
            },
          },
          AbortSignal.timeout(180_000)
        )
        setStreamingText(null)
        if (!result.ok) {
          useConversations.getState().appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { type: "error", error: result.error, scope: "consultation" },
            createdAt: new Date().toISOString(),
          })
          useConversations.getState().setPhase(target.id, "error")
          toast.error(result.error)
          return
        }
        const outcome = result.outcome as {
          message?: unknown
          phase?: unknown
          skill?: unknown
          brief?: unknown
          clarification?: unknown
          structured?: unknown
        }
        const state = useConversations.getState()
        if (typeof outcome.message === "string" && outcome.message.trim()) {
          state.appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { type: "assistant-text", text: outcome.message },
            createdAt: new Date().toISOString(),
          })
        }
        if (typeof outcome.skill === "string" && isSkillId(outcome.skill)) {
          // The consultant assigns (or changes) the asset skill.
          state.setSkill(target.id, outcome.skill)
        }
        if (
          isRecord(outcome.brief) &&
          typeof outcome.brief.concept === "string"
        ) {
          const brief = outcome.brief as unknown as NonNullable<
            typeof target.brief
          >
          state.setBrief(target.id, brief)
          state.appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { type: "brief", brief },
            createdAt: new Date().toISOString(),
          })
        }
        if (
          isRecord(outcome.clarification) &&
          typeof outcome.clarification.question === "string"
        ) {
          state.appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: {
              type: "clarification",
              question: outcome.clarification.question,
              suggestions: Array.isArray(outcome.clarification.suggestions)
                ? outcome.clarification.suggestions.filter(
                    (s): s is string => typeof s === "string"
                  )
                : undefined,
            },
            createdAt: new Date().toISOString(),
          })
        }
        state.setPhase(
          target.id,
          outcome.phase === "ready" && isRecord(outcome.brief)
            ? "ready_for_generation"
            : "awaiting_user"
        )
        if (typeof result.warning === "string") {
          toast.warning(result.warning)
        }
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "TimeoutError"
            ? "The consultation timed out."
            : "Could not reach the Aestry server."
        if (conversation) {
          useConversations.getState().appendMessage(conversation.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { type: "error", error: message, scope: "consultation" },
            createdAt: new Date().toISOString(),
          })
          useConversations.getState().setPhase(conversation.id, "error")
        }
        toast.error(message)
      } finally {
        setBusy(false)
      }
    },
    [busy, consultation, conversation, confirmCompactionNeeded, router, runCompaction]
  )

  const runGeneration = React.useCallback(
    async (count: 1 | 2 | 4) => {
      if (!conversation?.brief || !generation) return
      const record: GenerationRecord = {
        id: crypto.randomUUID(),
        skillId: conversation.skillId,
        prompt: "Compiled from the approved design brief",
        imageModel: generation.model,
        providerLabel: generation.providerId === "gemini" ? "Google Gemini" : "Google Vertex AI",
        count,
        status: "running",
        items: Array.from({ length: count }, () => ({
          id: crypto.randomUUID(),
          status: "pending" as const,
        })),
        createdAt: new Date().toISOString(),
      }
      useConversations.getState().addGeneration(conversation.id, record)
      useConversations.getState().appendMessage(conversation.id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: { type: "generation", generationId: record.id },
        createdAt: new Date().toISOString(),
      })
      useConversations.getState().setPhase(conversation.id, "generating")

      const referenceImages: Array<{ mimeType: string; data: string }> = []
      for (const reference of pendingReferences) {
        try {
          const stored = await loadImageBlob(reference.imageId)
          if (!stored) continue
          const buffer = await stored.blob.arrayBuffer()
          let binary = ""
          const bytes = new Uint8Array(buffer)
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i])
          }
          referenceImages.push({
            mimeType: reference.mimeType,
            data: btoa(binary),
          })
        } catch {
          continue
        }
      }

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: generation.providerId,
            model: generation.model,
            skillId: conversation.skillId,
            brief: conversation.brief,
            count,
            referenceImages:
              referenceImages.length > 0 ? referenceImages : undefined,
          }),
          signal: AbortSignal.timeout(240_000),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const message =
            isRecord(data) && typeof data.error === "string"
              ? data.error
              : `Generation failed (${response.status}).`
          useConversations
            .getState()
            .updateGeneration(conversation.id, record.id, {
              status: "done",
              warning: message,
            })
          for (const item of record.items) {
            useConversations
              .getState()
              .updateGenerationItem(conversation.id, record.id, item.id, {
                status: "failed",
                error: message,
              })
          }
          useConversations.getState().setPhase(conversation.id, "error")
          toast.error(message)
          return
        }
        if (!isRecord(data) || !Array.isArray(data.results)) {
          useConversations.getState().setPhase(conversation.id, "error")
          toast.error("The generation response could not be read.")
          return
        }
        const warning =
          isRecord(data) && typeof data.warning === "string"
            ? data.warning
            : undefined
        const compiledPrompt =
          isRecord(data) && typeof data.prompt === "string"
            ? data.prompt
            : record.prompt

        const results = data.results
        let done = 0
        let storageFailures = 0
        for (const [index, item] of results.entries()) {
          const recordItem = record.items[index]
          if (!recordItem) continue
          // Adapter contract: { ok: true, mimeType, data } per image.
          if (
            isRecord(item) &&
            item.ok === true &&
            typeof item.mimeType === "string" &&
            typeof item.data === "string"
          ) {
            const imageId = crypto.randomUUID()
            const binary = atob(item.data)
            const bytes = Uint8Array.from(binary, (char) =>
              char.charCodeAt(0)
            )
            const blob = new Blob([bytes], { type: item.mimeType })
            // The image is only reported as durably stored once the atomic
            // blob + asset write succeeds; a failure keeps it viewable for
            // this session and surfaces a storage warning instead.
            try {
              await saveGeneratedAsset({
                id: imageId,
                conversationId: conversation.id,
                generationId: record.id,
                skillId: conversation.skillId,
                imageModel: generation.model,
                mimeType: item.mimeType,
                blob,
              })
            } catch (storageError) {
              storageFailures += 1
              const quota =
                storageError instanceof Error &&
                storageError.name === "QuotaExceededError"
              toast.error(
                quota
                  ? "Browser storage is full — the image will be lost when this page closes."
                  : "The image could not be saved to browser storage."
              )
            }
            cacheImageUrl(imageId, URL.createObjectURL(blob))
            done += 1
            useConversations
              .getState()
              .updateGenerationItem(conversation.id, record.id, recordItem.id, {
                status: "done",
                imageId,
                mimeType: item.mimeType,
              })
          } else {
            const message =
              isRecord(item) &&
              item.ok === false &&
              typeof item.error === "string"
                ? item.error
                : "Generation failed."
            useConversations
              .getState()
              .updateGenerationItem(conversation.id, record.id, recordItem.id, {
                status: "failed",
                error: message,
              })
          }
        }
        const storageWarning =
          storageFailures > 0
            ? `${storageFailures.toString()} generated image${storageFailures === 1 ? "" : "s"} could not be saved to browser storage and will be lost when this page closes.`
            : undefined
        useConversations.getState().updateGeneration(conversation.id, record.id, {
          status: "done",
          prompt: compiledPrompt,
          warning: [warning, storageWarning].filter(Boolean).join(" ") || undefined,
        })
        useConversations.getState().setPhase(conversation.id, "reviewing")
        setPendingReferences([])
        if (done === 0) {
          toast.error("No images were generated.")
        } else {
          toast.success(
            `Generated ${done.toString()} of ${count.toString()} images`
          )
        }
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "TimeoutError"
            ? "Generation timed out."
            : "Could not reach the Aestry server."
        for (const item of record.items) {
          useConversations
            .getState()
            .updateGenerationItem(conversation.id, record.id, item.id, {
              status: "failed",
              error: message,
            })
        }
        useConversations.getState().updateGeneration(conversation.id, record.id, {
          status: "done",
        })
        useConversations.getState().setPhase(conversation.id, "error")
        toast.error(message)
      }
    },
    [conversation, generation, pendingReferences]
  )

  const retryGenerationItem = React.useCallback(
    async (generationId: string, itemId: string) => {
      if (!conversation?.brief || !generation) return
      const record = conversation.generations[generationId]
      if (!record) return
      const item = record.items.find((entry) => entry.id === itemId)
      if (!item) return
      useConversations
        .getState()
        .updateGenerationItem(conversation.id, generationId, itemId, {
          status: "pending",
          error: undefined,
        })
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: generation.providerId,
            model: generation.model,
            skillId: record.skillId,
            brief: conversation.brief,
            count: 1,
          }),
          signal: AbortSignal.timeout(240_000),
        })
        const data: unknown = await response.json().catch(() => null)
        const results =
          isRecord(data) && Array.isArray(data.results) ? data.results : []
        const first = results[0]
        if (
          response.ok &&
          isRecord(first) &&
          first.ok === true &&
          typeof first.mimeType === "string" &&
          typeof first.data === "string"
        ) {
          const imageId = crypto.randomUUID()
          const binary = atob(first.data)
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
          const blob = new Blob([bytes], { type: first.mimeType })
          try {
            await saveGeneratedAsset({
              id: imageId,
              conversationId: conversation.id,
              generationId,
              skillId: record.skillId,
              imageModel: generation.model,
              mimeType: first.mimeType,
              blob,
            })
          } catch {
            toast.error("The image could not be saved to browser storage.")
          }
          cacheImageUrl(imageId, URL.createObjectURL(blob))
          useConversations
            .getState()
            .updateGenerationItem(conversation.id, generationId, itemId, {
              status: "done",
              imageId,
              mimeType: first.mimeType,
            })
          toast.success("Image regenerated")
        } else {
          const message =
            isRecord(first) && first.ok === false && typeof first.error === "string"
              ? first.error
              : isRecord(data) && typeof data.error === "string"
                ? data.error
                : "Retry failed."
          useConversations
            .getState()
            .updateGenerationItem(conversation.id, generationId, itemId, {
              status: "failed",
              error: message,
            })
          toast.error(message)
        }
      } catch {
        useConversations
          .getState()
          .updateGenerationItem(conversation.id, generationId, itemId, {
            status: "failed",
            error: "Retry could not reach the server.",
          })
        toast.error("Retry could not reach the server.")
      }
    },
    [conversation, generation]
  )

  const useAsReference = React.useCallback((imageId: string, mimeType: string) => {
    setPendingReferences((previous) => {
      if (previous.some((reference) => reference.imageId === imageId)) {
        return previous
      }
      return [...previous, { imageId, mimeType }]
    })
    toast.info("Added as a refinement reference for the next generation.")
  }, [])

  if (!mounted) {
    return <div className="min-h-[calc(100dvh-2.5rem)]" aria-hidden="true" />
  }

  if (missing && conversationId) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-sm font-medium text-foreground">
          Conversation not found
        </p>
        <p className="text-sm text-muted-foreground">
          It may have been deleted from this browser.
        </p>
        <Button render={<Link href="/" />} nativeButton={false}>
          Start a new conversation
        </Button>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 flex flex-col gap-2 text-center duration-500">
          <WelcomeOrb className="mb-4 flex justify-center" />
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            What would you like to create?
          </h1>
          <p className="text-sm text-muted-foreground">
            Describe your idea, share a project, or upload a reference image.
          </p>
        </div>
        <div className="mx-auto w-full max-w-2xl animate-in fade-in-0 slide-in-from-bottom-2 mt-8 duration-500">
          <Composer
            variant="welcome"
            busy={busy}
            suggestions={WELCOME_SUGGESTIONS}
            onSend={(text, files) => void handleSend(text, files)}
          />
        </div>
      </div>
    )
  }

  const generatableBriefId =
    conversation.phase === "ready_for_generation"
      ? [...conversation.messages]
          .reverse()
          .find((message) => message.content.type === "brief")?.id
      : undefined

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
          <MessageList
            messages={conversation.messages}
            generations={conversation.generations}
            skillId={conversation.skillId}
            generatableBriefId={generatableBriefId}
            streamingText={streamingText}
            onGenerate={(count) => void runGeneration(count)}
            onRetryItem={(generationId, itemId) =>
              void retryGenerationItem(generationId, itemId)
            }
            onClarificationSuggestion={(suggestion) =>
              void handleSend(suggestion, [])
            }
            onUseAsReference={useAsReference}
          />
          {busy && conversation.phase === "consulting" ? (
            <div className="mt-6">
              <ThinkingOrbIndicator activity="consult" />
            </div>
          ) : null}
          <div className="h-2" />
        </div>
      </div>
      {!nearBottom ? (
        <div className="pointer-events-none relative">
          <Button
            variant="outline"
            size="icon-sm"
            className="pointer-events-auto absolute -top-12 right-6 shadow-md"
            aria-label="Scroll to newest message"
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDownIcon />
          </Button>
        </div>
      ) : null}
      {storageWarning ? (
        <div
          role="status"
          className="shrink-0 bg-warning/10 px-4 py-2 text-xs text-warning sm:px-6"
        >
          <div className="mx-auto w-full max-w-4xl">{storageWarning}</div>
        </div>
      ) : null}
      <div className="shrink-0 bg-background px-4 pb-3 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          {pendingReferences.length > 0 ? (
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Using {pendingReferences.length.toString()} generated image
                {pendingReferences.length === 1 ? "" : "s"} as refinement
                reference.
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setPendingReferences([])}
              >
                Clear
              </Button>
            </div>
          ) : null}
          <Composer
            variant="conversation"
            busy={busy}
            contextTokens={conversation.contextTokens ?? null}
            compacting={compacting}
            onCompact={() => void runCompaction(conversation.id)}
            onSend={(text, files) => void handleSend(text, files)}
          />
        </div>
      </div>
    </div>
  )
}
