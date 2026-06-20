"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MarkupEditor from "./MarkupEditor";
import NewProjectForm from "./NewProjectForm";
import DeleteProjectButton from "./DeleteProjectButton";
import ReopenProjectButton from "./ReopenProjectButton";
import RequestedMarkerTypes from "./RequestedMarkerTypes";
import CopyLinkButton from "./CopyLinkButton";
import DownloadPdfButton from "./DownloadPdfButton";
import type { ProjectData } from "@/lib/types";

export type ProjectListItem = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  markerCount: number;
  ieCount: number;
};

type ProjectDetail = ProjectData & { createdAt: string };

export default function StaffShell({
  initialProjects,
  initialSelectedId,
  initialDetail,
  useBlob,
}: {
  initialProjects: ProjectListItem[];
  initialSelectedId?: string;
  initialDetail?: ProjectDetail;
  useBlob: boolean;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [detail, setDetail] = useState<ProjectDetail | null>(initialDetail ?? null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function refreshList() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }

  async function loadDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }

  function selectProject(id: string) {
    setSelectedId(id);
    setShowNewProject(false);
    router.replace(`/staff/${id}`);
    if (detail?.id !== id) loadDetail(id);
  }

  function backToList() {
    setSelectedId(null);
    router.replace("/staff");
  }

  function handleCreated(id: string) {
    setShowNewProject(false);
    refreshList();
    selectProject(id);
  }

  function handleDeleted() {
    setDetail(null);
    backToList();
    refreshList();
  }

  async function handleChanged() {
    refreshList();
    if (selectedId) loadDetail(selectedId);
  }

  const shareUrl = detail ? `${origin}/markup/${detail.shareToken}` : "";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-black">
      <div
        className={`${
          selectedId ? "hidden md:flex" : "flex"
        } w-full shrink-0 flex-col gap-3 overflow-y-auto border-r border-gray-200 p-4 dark:border-gray-800 md:w-80`}
      >
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Site Markup Projects</h1>
          <button
            type="button"
            onClick={() => setShowNewProject((v) => !v)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showNewProject ? "Cancel" : "+ New project"}
          </button>
        </div>

        {showNewProject && <NewProjectForm useBlob={useBlob} onCreated={handleCreated} />}

        <div className="flex flex-col gap-2">
          {projects.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No projects yet. Create one above.</p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => selectProject(project.id)}
              className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-left hover:opacity-80 dark:border-gray-800 ${
                project.id === selectedId ? "border-blue-400 bg-blue-50 dark:bg-blue-950" : ""
              }`}
            >
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{project.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(project.createdAt).toLocaleDateString()} · {project.markerCount} markers
                  {project.status === "submitted" && ` · ${project.ieCount} IE`}
                </div>
              </div>
              <span
                className={`rounded-full bg-gray-100 px-2 py-1 text-xs font-medium dark:bg-gray-900 ${
                  project.status === "submitted"
                    ? "text-green-700 dark:text-emerald-500"
                    : "text-yellow-700 dark:text-amber-500"
                }`}
              >
                {project.status}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${selectedId ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {!selectedId && (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Select a project to view its markup.
          </div>
        )}
        {selectedId && detailLoading && !detail && (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Loading...
          </div>
        )}
        {selectedId && detail && (
          <>
            <div className="flex flex-col gap-2 border-b border-gray-200 p-3 dark:border-gray-800">
              <button
                type="button"
                onClick={backToList}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 md:hidden dark:text-gray-400 dark:hover:text-gray-100"
              >
                ← Back to projects
              </button>
              <p className="flex flex-wrap items-center gap-2 text-xs break-all text-gray-600 dark:text-gray-400">
                Client link:{" "}
                <a href={shareUrl} className="font-medium text-blue-600 underline dark:text-blue-500">
                  {shareUrl}
                </a>
                <CopyLinkButton url={shareUrl} />
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {detail.status === "submitted" && (
                  <>
                    <DownloadPdfButton
                      href={`/api/projects/${detail.id}/pdf`}
                      filenameFallback={`${detail.name}.pdf`}
                    />
                    <ReopenProjectButton shareToken={detail.shareToken} onReopened={handleChanged} />
                  </>
                )}
                <DeleteProjectButton projectId={detail.id} projectName={detail.name} onDeleted={handleDeleted} />
              </div>
              <RequestedMarkerTypes
                projectId={detail.id}
                allowIE={detail.allowIE}
                allowSection={detail.allowSection}
              />
            </div>
            <div className="relative flex-1">
              <MarkupEditor token={detail.shareToken} project={detail} readOnly embedded />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
