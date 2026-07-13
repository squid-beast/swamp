import { notFound } from "next/navigation";
import { Suspense } from "react";
import { store } from "@/features/datasets/storage/store";
import { Workspace } from "@/features/datasets/components/Workspace";

export const dynamic = "force-dynamic";

export default async function DatasetPage({ params }: { params: { id: string } }) {
  const dataset = await store.get(params.id);
  if (!dataset) notFound();
  const rows = await store.getRows(params.id);
  return (
    <Suspense>
      <Workspace dataset={dataset} rows={rows} />
    </Suspense>
  );
}
