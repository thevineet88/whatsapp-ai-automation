import { STANDARD_POINTS_TO_NOTE } from "@/lib/core/package";
import { PackageForm } from "../PackageForm";
import { createPackage } from "../actions";

export default async function NewPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">New package</h1>
      </div>

      {error ? <p className="text-error">{error}</p> : null}

      <div className="card">
        <PackageForm
          action={createPackage}
          defaults={{ pointsToNote: STANDARD_POINTS_TO_NOTE }}
          submitLabel="Create package"
        />
      </div>
    </>
  );
}
