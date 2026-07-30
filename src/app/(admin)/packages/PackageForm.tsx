"use client";

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
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" defaultValue={defaults?.name} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="slug">
            Slug (lowercase-kebab-case)
          </label>
          <input id="slug" name="slug" defaultValue={defaults?.slug} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="category">
            Category (select one or more)
          </label>
          <select id="category" name="category" multiple defaultValue={defaults?.category ?? []}>
            {packageCategoryValues.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <p className="field-hint">Ctrl+Click to select multiple categories</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="durationDays">
            Duration (days)
          </label>
          <input
            id="durationDays"
            type="number"
            name="durationDays"
            defaultValue={defaults?.durationDays}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="durationNights">
            Duration (nights)
          </label>
          <input
            id="durationNights"
            type="number"
            name="durationNights"
            defaultValue={defaults?.durationNights}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="departurePoint">
            Departure point
          </label>
          <input
            id="departurePoint"
            name="departurePoint"
            defaultValue={defaults?.departurePoint}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="travelMode">
            Travel mode
          </label>
          <input id="travelMode" name="travelMode" defaultValue={defaults?.travelMode} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="returnPoint">
            Return point
          </label>
          <input
            id="returnPoint"
            name="returnPoint"
            defaultValue={defaults?.returnPoint}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="flightInformation">
            Flight information (optional)
          </label>
          <input
            id="flightInformation"
            name="flightInformation"
            defaultValue={defaults?.flightInformation ?? ""}
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="advisory">
          Advisory
        </label>
        <textarea id="advisory" name="advisory" rows={3} defaultValue={defaults?.advisory} required />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="highlights">
          Trip highlights (one per line)
        </label>
        <textarea
          id="highlights"
          name="highlights"
          rows={4}
          defaultValue={defaults?.highlights?.join("\n")}
          required
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="itinerary">
          Day-by-day itinerary (one per line, format: day|title|description)
        </label>
        <textarea
          id="itinerary"
          name="itinerary"
          rows={8}
          defaultValue={itineraryText}
          required
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="inclusions">
          Inclusions (one per line)
        </label>
        <textarea
          id="inclusions"
          name="inclusions"
          rows={4}
          defaultValue={defaults?.inclusions?.join("\n")}
          required
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="exclusions">
          Exclusions (one per line)
        </label>
        <textarea
          id="exclusions"
          name="exclusions"
          rows={4}
          defaultValue={defaults?.exclusions?.join("\n")}
          required
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="pointsToNote">
          Points to note (one per line)
        </label>
        <textarea
          id="pointsToNote"
          name="pointsToNote"
          rows={5}
          defaultValue={defaults?.pointsToNote?.join("\n")}
          required
        />
      </div>

      <div className="field">
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}