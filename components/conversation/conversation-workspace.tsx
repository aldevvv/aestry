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
import { Spinner } from "@/components/ui/spinner"
import { useMounted } from "@/hooks/use-mounted"
import {
  buildConsultationTurns,
} from "@/lib/conversation/consultation"
import { detectGitHubUrl, fetchProjectContext } from "@/lib/conversation/project-context"
import {
  loadImageBlob,
  saveImageBlob,
} from "@/lib/conversation/persistence"
import {
  selectActiveConversation,
  useConversations,
} from "@/lib/conversation/store"
import {
  resolveSelection,
  inferCapabilities,
  useProviders,
} from "@/lib/provider-store"
import { getSkill, type SkillId } from "@/lib/skills/registry"
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

const WELCOME_SUGGESTIONS: Array<{ skillId: SkillId; text: string }> = [
  {
    skillId: "app-icon",
    text: "Design a modern app icon for a productivity application.",
  },
  { skillId: "logo", text: "Create a minimal logo for my developer tool." },
  {
    skillId: "og-image",
    text: "Create an OG image for my open-source project.",
  },
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
  const providers = useProviders((state) => state.providers)
  const selections = useProviders((state) => state.selections)
  const consultation = resolveSelection(providers, selections.consultation)
  const generation = resolveSelection(providers, selections.generation)

  const [localSkillId, setLocalSkillId] = React.useState<SkillId>("app-icon")
  const [busy, setBusy] = React.useState(false)
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

  const handleSkillChange = React.useCallback(
    (nextSkillId: SkillId) => {
      if (conversation) {
        if (conversation.skillId !== nextSkillId) {
          useConversations.getState().setSkill(conversation.id, nextSkillId)
          useConversations.getState().appendMessage(conversation.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: {
              type: "context",
              title: "Skill changed",
              summary: `This conversation is now designing a ${getSkill(nextSkillId).name}. Earlier decisions are kept unless you revisit them.`,
            },
            createdAt: new Date().toISOString(),
          })
        }
      } else {
        setLocalSkillId(nextSkillId)
      }
    },
    [conversation]
  )

  const handleQuantityChange = React.useCallback(
    (quantity: 1 | 2 | 4) => {
      if (conversation) {
        useConversations.getState().setQuantity(conversation.id, quantity)
      }
    },
    [conversation]
  )

  const handleSend = React.useCallback(
    async (text: string, files: File[]) => {
      if (!consultation || busy) return
      setBusy(true)
      try {
        let target = conversation
        if (!target) {
          target = useConversations.getState().createConversation(localSkillId)
          router.push(`/chat/${target.id}`)
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
        const history = buildConsultationTurns(latest?.messages ?? [])
        const capabilities = inferCapabilities(
          consultation.provider.kind,
          consultation.model
        )

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: consultation.provider.kind,
            apiKey: consultation.provider.apiKey,
            model: consultation.model,
            baseUrl: consultation.provider.baseUrl,
            skillId: target.skillId,
            brief: target.brief,
            history,
            referenceImages:
              capabilities.vision && referenceImages.length > 0
                ? referenceImages
                : undefined,
            projectContext: projectContextSummary,
          }),
          signal: AbortSignal.timeout(180_000),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const message =
            isRecord(data) && typeof data.error === "string"
              ? data.error
              : `Consultation failed (${response.status}).`
          useConversations.getState().appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { type: "error", error: message, scope: "consultation" },
            createdAt: new Date().toISOString(),
          })
          useConversations.getState().setPhase(target.id, "error")
          toast.error(message)
          return
        }
        if (!isRecord(data) || !isRecord(data.outcome)) {
          useConversations.getState().appendMessage(target.id, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: {
              type: "error",
              error: "The consultation response could not be read.",
              scope: "consultation",
            },
            createdAt: new Date().toISOString(),
          })
          useConversations.getState().setPhase(target.id, "error")
          return
        }
        const outcome = data.outcome as {
          message?: unknown
          phase?: unknown
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
        if (typeof data.warning === "string") {
          toast.warning(data.warning)
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
    [busy, consultation, conversation, localSkillId, router]
  )

  const runGeneration = React.useCallback(
    async (count: 1 | 2 | 4) => {
      if (!conversation?.brief || !generation) return
      const provider = generation.provider
      const record: GenerationRecord = {
        id: crypto.randomUUID(),
        skillId: conversation.skillId,
        prompt: "Compiled from the approved design brief",
        imageModel: generation.model,
        providerLabel: provider.label,
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
            kind: provider.kind,
            apiKey: provider.apiKey,
            model: generation.model,
            baseUrl: provider.baseUrl,
            skillId: conversation.skillId,
            brief: conversation.brief,
            count,
            size: getSkill(conversation.skillId).openAiSize,
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
        results.forEach((item: unknown, index: number) => {
          const recordItem = record.items[index]
          if (!recordItem) return
          if (
            isRecord(item) &&
            item.ok === true &&
            isRecord(item.image) &&
            typeof item.image.mimeType === "string" &&
            typeof item.image.data === "string"
          ) {
            const imageId = crypto.randomUUID()
            const binary = atob(item.image.data)
            const bytes = Uint8Array.from(binary, (char) =>
              char.charCodeAt(0)
            )
            const blob = new Blob([bytes], { type: item.image.mimeType })
            void saveImageBlob({
              id: imageId,
              conversationId: conversation.id,
              role: "generated",
              mimeType: item.image.mimeType,
              blob,
            })
            cacheImageUrl(imageId, URL.createObjectURL(blob))
            done += 1
            useConversations
              .getState()
              .updateGenerationItem(conversation.id, record.id, recordItem.id, {
                status: "done",
                imageId,
                mimeType: item.image.mimeType,
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
        })
        useConversations.getState().updateGeneration(conversation.id, record.id, {
          status: "done",
          prompt: compiledPrompt,
          warning,
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
            kind: generation.provider.kind,
            apiKey: generation.provider.apiKey,
            model: generation.model,
            baseUrl: generation.provider.baseUrl,
            skillId: record.skillId,
            brief: conversation.brief,
            count: 1,
            size: getSkill(record.skillId).openAiSize,
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
          isRecord(first.image) &&
          typeof first.image.mimeType === "string" &&
          typeof first.image.data === "string"
        ) {
          const imageId = crypto.randomUUID()
          const binary = atob(first.image.data)
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
          const blob = new Blob([bytes], { type: first.image.mimeType })
          void saveImageBlob({
            id: imageId,
            conversationId: conversation.id,
            role: "generated",
            mimeType: first.image.mimeType,
            blob,
          })
          cacheImageUrl(imageId, URL.createObjectURL(blob))
          useConversations
            .getState()
            .updateGenerationItem(conversation.id, generationId, itemId, {
              status: "done",
              imageId,
              mimeType: first.image.mimeType,
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
    return <div className="min-h-[calc(100dvh-3rem)]" aria-hidden="true" />
  }

  if (missing && conversationId) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
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
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 flex flex-col gap-2 text-center duration-500">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            What would you like to create?
          </h1>
          <p className="text-sm text-muted-foreground">
            Describe your idea, share a project, or upload a reference image.
          </p>
        </div>
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 mt-8 duration-500">
          <Composer
            variant="welcome"
            skillId={localSkillId}
            quantity={1}
            consultationLabel={
              consultation
                ? `${consultation.provider.label} · ${consultation.model}`
                : null
            }
            generationLabel={
              generation ? `${generation.provider.label} · ${generation.model}` : null
            }
            busy={busy}
            suggestions={WELCOME_SUGGESTIONS}
            onSend={(text, files) => void handleSend(text, files)}
            onSkillChange={handleSkillChange}
            onQuantityChange={() => {}}
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
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
          <MessageList
            messages={conversation.messages}
            generations={conversation.generations}
            skillId={conversation.skillId}
            generatableBriefId={generatableBriefId}
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
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Consulting…
            </div>
          ) : null}
          <div className="h-4" />
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
      <div className="shrink-0 border-t border-border bg-background px-4 pb-3 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
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
            skillId={conversation.skillId}
            quantity={conversation.quantity}
            consultationLabel={
              consultation
                ? `${consultation.provider.label} · ${consultation.model}`
                : null
            }
            generationLabel={
              generation ? `${generation.provider.label} · ${generation.model}` : null
            }
            busy={busy}
            onSend={(text, files) => void handleSend(text, files)}
            onSkillChange={handleSkillChange}
            onQuantityChange={handleQuantityChange}
          />
        </div>
      </div>
    </div>
  )
}
