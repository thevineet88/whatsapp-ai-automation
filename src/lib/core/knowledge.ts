import { z } from "zod";

// A knowledge source is one logical document (e.g. "best season for the
// Sikkim-Darjeeling package") that gets chunked and embedded. `source` is a
// stable key so re-ingesting the same source replaces its old chunks instead
// of duplicating them.
export const knowledgeSourceInputSchema = z.object({
  packageId: z.string().uuid().nullable(),
  source: z.string().min(1),
  content: z.string().min(1),
});
export type KnowledgeSourceInput = z.infer<typeof knowledgeSourceInputSchema>;
