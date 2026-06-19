import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { toProjectData } from "@/lib/types";
import MarkupEditor from "@/components/MarkupEditor";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import ReopenProjectButton from "@/components/ReopenProjectButton";
import RequestedMarkerTypes from "@/components/RequestedMarkerTypes";

export default async function StaffProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      documents: {
        include: {
          pages: { include: { markers: { include: { directions: { orderBy: { order: "asc" } } } } } },
        },
      },
    },
  });

  if (!project) notFound();

  const host = (await headers()).get("host");
  const shareUrl = `${process.env.NODE_ENV === "production" ? "https" : "http"}://${host}/markup/${project.shareToken}`;

  const headerExtra = (
    <div className="flex flex-col gap-2 border-b border-gray-200 pb-3 dark:border-gray-700">
      <Link
        href="/staff"
        className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        ← Back to dashboard
      </Link>
      <p className="text-xs break-all text-gray-600 dark:text-gray-400">
        Client link:{" "}
        <a href={shareUrl} className="font-medium text-blue-600 underline dark:text-blue-400">
          {shareUrl}
        </a>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {project.status === "submitted" && (
          <>
            <a
              href={`/api/projects/${project.id}/pdf`}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-green-400 dark:hover:bg-gray-700"
            >
              Download PDF
            </a>
            <ReopenProjectButton shareToken={project.shareToken} />
          </>
        )}
        <DeleteProjectButton projectId={project.id} projectName={project.name} redirectTo="/staff" />
      </div>
      <RequestedMarkerTypes
        projectId={project.id}
        allowIE={project.allowIE}
        allowSection={project.allowSection}
      />
    </div>
  );

  return (
    <MarkupEditor
      token={project.shareToken}
      project={toProjectData(project)}
      readOnly
      headerExtra={headerExtra}
    />
  );
}
