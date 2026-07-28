import { z } from "zod";

export const whatsappMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});
export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

const whatsappValueSchema = z.object({
  metadata: z.object({
    phone_number_id: z.string(),
    display_phone_number: z.string().optional(),
  }),
  messages: z.array(whatsappMessageSchema).optional(),
});

const whatsappChangeSchema = z.object({
  field: z.string(),
  value: whatsappValueSchema,
});

const whatsappEntrySchema = z.object({
  id: z.string(),
  changes: z.array(whatsappChangeSchema),
});

export const whatsappWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(whatsappEntrySchema),
});
export type WhatsAppWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
