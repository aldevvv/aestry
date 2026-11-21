import type { Metadata } from "next"

import { ProjectView } from "@/components/project-view"

export const metadata: Metadata = {
  title: "Project",
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <ProjectView projectId={id} />
    </div>
  )
}
