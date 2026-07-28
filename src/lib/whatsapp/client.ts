import { z } from "zod";

const GRAPH_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

const sendMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).min(1),
});

export type SendTextMessageResult =
  | { ok: true; metaMessageId: string }
  | { ok: false; error: string };

export type WhatsAppClientConfig = {
  accessToken: string;
  phoneNumberId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createWhatsAppClient(config: WhatsAppClientConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  async function sendTextMessage(to: string, body: string): Promise<SendTextMessageResult> {
    try {
      const res = await fetchWithRetry(fetchImpl, `${baseUrl}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        return { ok: false, error: `whatsapp send failed: ${res.status} ${errorBody}` };
      }

      const parsed = sendMessageResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        return { ok: false, error: "whatsapp send: unexpected response shape" };
      }

      return { ok: true, metaMessageId: parsed.data.messages[0].id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `whatsapp send: ${message}` };
    }
  }

  return { sendTextMessage };
}
export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>;

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function backoffMs(attempt: number): number {
  return 250 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
