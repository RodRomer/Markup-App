import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toProjectData } from "@/lib/types";
import MarkupEditor from "@/components/MarkupEditor";

export default async function MarkupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const project = await prisma.project.findUnique({
    where: { shareToken: token },
    include: {
      documents: {
        include: {
          pages: { include: { markers: { include: { directions: { orderBy: { order: "asc" } } } } } },
        },
      },
    },
  });

  if (!project) notFound();

  return (
    <MarkupEditor token={token} project={toProjectData(project)} />
  );
}
