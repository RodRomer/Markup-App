import Link from "next/link";
import { prisma } from "@/lib/db";
import NewProjectForm from "@/components/NewProjectForm";
import DeleteProjectButton from "@/components/DeleteProjectButton";

export const dynamic = "force-dynamic";

export default async function StaffDashboard() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { documents: { include: { pages: { include: { markers: true } } } } },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Site Markup Projects</h1>
      <NewProjectForm />

      <div className="flex flex-col gap-2">
        {projects.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No projects yet. Create one above.</p>
        )}
        {projects.map((project) => {
          const markerCount = project.documents
            .flatMap((d) => d.pages)
            .flatMap((p) => p.markers).length;
          return (
            <div
              key={project.id}
              className="flex items-center justify-between gap-3 rounded-md border px-4 py-3 dark:border-gray-700"
            >
              <Link
                href={`/staff/${project.id}`}
                className="flex flex-1 items-center justify-between gap-3 hover:opacity-80"
              >
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{project.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {project.createdAt.toLocaleDateString()} · {markerCount} markers
                  </div>
                </div>
                <span
                  className={`rounded-full bg-gray-100 px-2 py-1 text-xs font-medium dark:bg-gray-800 ${
                    project.status === "submitted"
                      ? "text-green-700 dark:text-green-400"
                      : "text-yellow-700 dark:text-yellow-400"
                  }`}
                >
                  {project.status}
                </span>
              </Link>
              {project.status === "submitted" && (
                <a
                  href={`/api/projects/${project.id}/pdf`}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-green-400 dark:hover:bg-gray-700"
                >
                  Download PDF
                </a>
              )}
              <DeleteProjectButton projectId={project.id} projectName={project.name} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
