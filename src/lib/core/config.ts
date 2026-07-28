import { z } from "zod";

export const escalationContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
});
export type EscalationContact = z.infer<typeof escalationContactSchema>;

export const tenantConfigInputSchema = z.object({
  escalationContacts: z.array(escalationContactSchema).min(1),
});
export type TenantConfigInput = z.infer<typeof tenantConfigInputSchema>;
