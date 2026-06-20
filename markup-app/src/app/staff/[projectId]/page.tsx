import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toProjectData } from "@/lib/types";
import StaffShell, { type ProjectListItem } from "@/components/StaffShell";

export const dynamic = "force-dynamic";

async function fetchProjectList(): Promise<ProjectListItem[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { documents: { include: { pages: { include: { markers: true } } } } },
  });

  return projects.map((project) => {
    const allMarkers = project.documents.flatMap((d) => d.pages).flatMap((p) => p.markers);
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      markerCount: allMarkers.length,
      ieCount: allMarkers.filter((m) => m.type === "IE").length,
    };
  });
}

export default async function StaffProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [projects, project] = await Promise.all([
    fetchProjectList(),
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        documents: {
          include: {
            pages: { include: { markers: { include: { directions: { orderBy: { order: "asc" } } } } } },
          },
        },
      },
    }),
  ]);

  if (!project) notFound();

  return (
    <StaffShell
      initialProjects={projects}
      initialSelectedId={project.id}
      initialDetail={{ ...toProjectData(project), createdAt: project.createdAt.toISOString() }}
      useBlob={!!process.env.BLOB_READ_WRITE_TOKEN}
    />
  );
}
