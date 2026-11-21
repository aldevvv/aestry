import { PromptComposer } from "@/components/prompt-composer"

export default function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 flex flex-col gap-2 text-center duration-500">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          What would you like to create?
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Describe your idea, share a project URL, or upload a reference image.
        </p>
      </div>
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 mt-8 duration-500">
        <PromptComposer />
      </div>
    </div>
  )
}
