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

// A traveller's message is not something we can afford to drop on the first
// transient failure (an expired token being refreshed, a Meta blip, a
// database restart). Retries are spread over roughly ten minutes, which
// covers a redeploy, and the handler is idempotent so replaying a job cannot
// duplicate the traveller's message.
const JOB_ATTEMPTS = 5;
const JOB_BACKOFF_MS = 5_000;

export function createWhatsappInboundQueue(connection: RedisClient) {
  return new Queue<WhatsAppInboundJob>(WHATSAPP_INBOUND_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: JOB_BACKOFF_MS },
      // Failed jobs are kept: they are the record of messages the system
      // never managed to answer, and deleting them would hide exactly the
      // incidents worth reviewing.
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 5_000 },
      removeOnFail: false,
    },
  });
}
export type WhatsappInboundQueue = ReturnType<typeof createWhatsappInboundQueue>;
