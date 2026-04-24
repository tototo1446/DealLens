import { notFound } from "next/navigation";
import { getJob } from "@/lib/db/jobs";
import { JobDetail } from "./job-detail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  return <JobDetail jobId={id} />;
}
