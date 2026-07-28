import { z } from "zod";

export const escalationContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
});
export type EscalationContact = z.infer<typeof escalationContactSchema>;

// Sent to a traveller whenever the bot hands the conversation to a human
// instead of generating an answer. Overridable per tenant via the config
// admin page.
export const DEFAULT_HOLDING_REPLY =
  "Thanks for reaching out to Samyati Holidays! One of our team members will get back to you shortly.";

export const tenantConfigInputSchema = z.object({
  escalationContacts: z.array(escalationContactSchema).min(1),
  holdingReplyMessage: z.string().min(1).default(DEFAULT_HOLDING_REPLY),
});
export type TenantConfigInput = z.infer<typeof tenantConfigInputSchema>;
