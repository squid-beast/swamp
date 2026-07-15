import { Suspense } from "react";
import { ImportPanel } from "@/features/tables/components/import-panel";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  // ImportPanel reads ?baseId via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense>
      <ImportPanel />
    </Suspense>
  );
}
