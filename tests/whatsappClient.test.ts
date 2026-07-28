import { describe, expect, it, vi } from "vitest";
import { createWhatsAppClient } from "../src/lib/whatsapp/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createWhatsAppClient", () => {
  it("returns the Meta message id on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messages: [{ id: "wamid.1" }] }));
    const client = createWhatsAppClient({
      accessToken: "token",
      phoneNumberId: "phone-1",
      fetchImpl,
    });

    const result = await client.sendTextMessage("919876543210", "hello");

    expect(result).toEqual({ ok: true, metaMessageId: "wamid.1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/phone-1/messages");
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("maps a 4xx response to a typed failure without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = createWhatsAppClient({
      accessToken: "token",
      phoneNumberId: "phone-1",
      fetchImpl,
    });

    const result = await client.sendTextMessage("919876543210", "hello");

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and succeeds once a retry returns 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: "wamid.2" }] }));

    const client = createWhatsAppClient({
      accessToken: "token",
      phoneNumberId: "phone-1",
      fetchImpl,
    });

    const result = await client.sendTextMessage("919876543210", "hello");

    expect(result).toEqual({ ok: true, metaMessageId: "wamid.2" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a typed failure after exhausting retries on repeated errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const client = createWhatsAppClient({
      accessToken: "token",
      phoneNumberId: "phone-1",
      fetchImpl,
    });

    const result = await client.sendTextMessage("919876543210", "hello");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network down");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
