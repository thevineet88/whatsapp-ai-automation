import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const provided = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), "hex");
  const expected = Buffer.from(
    createHmac("sha256", appSecret).update(rawBody).digest("hex"),
    "hex",
  );

  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
