import { prisma } from "@/lib/db";
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

export default async function StaffDashboard() {
  const projects = await fetchProjectList();

  return <StaffShell initialProjects={projects} useBlob={!!process.env.BLOB_READ_WRITE_TOKEN} />;
}
