import { STANDARD_POINTS_TO_NOTE } from "@/lib/core/package";
import { PackageForm } from "../PackageForm";
import { createPackage } from "../actions";

export default async function NewPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const defaults = { pointsToNote: STANDARD_POINTS_TO_NOTE };

  return (
    <main>
      <h1>New package</h1>
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      <PackageForm action={createPackage} defaults={defaults} submitLabel="Create package" />
    </main>
  );
}
