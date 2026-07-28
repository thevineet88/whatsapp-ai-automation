import { packageCategoryValues } from "@/lib/core/package";
import type { packages } from "@/lib/db/schema";

type PackageRow = Partial<typeof packages.$inferSelect>;

export function PackageForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults?: PackageRow;
  submitLabel: string;
}) {
  const itineraryText = (defaults?.itinerary ?? [])
    .map((day) => `${day.day}|${day.title}|${day.description}`)
    .join("\n");

  return (
    <form action={action}>
      <Field label="Name" htmlFor="name">
        <input id="name" name="name" defaultValue={defaults?.name} required />
      </Field>
      <Field label="Slug (lowercase-kebab-case)" htmlFor="slug">
        <input id="slug" name="slug" defaultValue={defaults?.slug} required />
      </Field>
      <Field label="Category (select one or more)" htmlFor="category">
        <select id="category" name="category" multiple defaultValue={defaults?.category ?? []}>
          {packageCategoryValues.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Duration (days)" htmlFor="durationDays">
        <input
          id="durationDays"
          type="number"
          name="durationDays"
          defaultValue={defaults?.durationDays}
          required
        />
      </Field>
      <Field label="Duration (nights)" htmlFor="durationNights">
        <input
          id="durationNights"
          type="number"
          name="durationNights"
          defaultValue={defaults?.durationNights}
          required
        />
      </Field>
      <Field label="Departure point" htmlFor="departurePoint">
        <input
          id="departurePoint"
          name="departurePoint"
          defaultValue={defaults?.departurePoint}
          required
        />
      </Field>
      <Field label="Travel mode" htmlFor="travelMode">
        <input id="travelMode" name="travelMode" defaultValue={defaults?.travelMode} required />
      </Field>
      <Field label="Return point" htmlFor="returnPoint">
        <input id="returnPoint" name="returnPoint" defaultValue={defaults?.returnPoint} required />
      </Field>
      <Field label="Flight information (optional)" htmlFor="flightInformation">
        <input
          id="flightInformation"
          name="flightInformation"
          defaultValue={defaults?.flightInformation ?? ""}
        />
      </Field>
      <Field label="Advisory" htmlFor="advisory">
        <textarea
          id="advisory"
          name="advisory"
          rows={3}
          defaultValue={defaults?.advisory}
          required
        />
      </Field>
      <Field label="Highlights (one per line)" htmlFor="highlights">
        <textarea
          id="highlights"
          name="highlights"
          rows={4}
          defaultValue={defaults?.highlights?.join("\n")}
          required
        />
      </Field>
      <Field label="Itinerary (one per line, format: day|title|description)" htmlFor="itinerary">
        <textarea id="itinerary" name="itinerary" rows={8} defaultValue={itineraryText} required />
      </Field>
      <Field label="Inclusions (one per line)" htmlFor="inclusions">
        <textarea
          id="inclusions"
          name="inclusions"
          rows={4}
          defaultValue={defaults?.inclusions?.join("\n")}
          required
        />
      </Field>
      <Field label="Exclusions (one per line)" htmlFor="exclusions">
        <textarea
          id="exclusions"
          name="exclusions"
          rows={4}
          defaultValue={defaults?.exclusions?.join("\n")}
          required
        />
      </Field>
      <Field label="Points to note (one per line)" htmlFor="pointsToNote">
        <textarea
          id="pointsToNote"
          name="pointsToNote"
          rows={5}
          defaultValue={defaults?.pointsToNote?.join("\n")}
          required
        />
      </Field>
      <button type="submit" style={{ marginTop: "1rem" }}>
        {submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <label
        htmlFor={htmlFor}
        style={{ display: "block", fontWeight: "bold", marginBottom: "0.25rem" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
