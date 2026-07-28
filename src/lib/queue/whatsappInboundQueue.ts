import { Queue } from "bullmq";
import type { WhatsAppMessage } from "../core/webhook";
import type { RedisClient } from "../redis/client";

export const WHATSAPP_INBOUND_QUEUE = "whatsapp-inbound";

export type WhatsAppInboundJob = {
  tenantId: string;
  whatsappAccountId: string;
  phoneNumberId: string;
  message: WhatsAppMessage;
};

export function createWhatsappInboundQueue(connection: RedisClient) {
  return new Queue<WhatsAppInboundJob>(WHATSAPP_INBOUND_QUEUE, { connection });
}
export type WhatsappInboundQueue = ReturnType<typeof createWhatsappInboundQueue>;
