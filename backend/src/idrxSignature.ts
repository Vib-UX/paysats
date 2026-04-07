import * as crypto from "crypto";

/**
 * IDRX API HMAC signing — https://docs.idrx.co/api/generating-a-signature
 * Order: timestamp, method, url, JSON body buffer. Secret is base64-encoded.
 */
export function createIdrxSignature(
  method: string,
  url: string,
  body: object,
  timestamp: string,
  secretKeyBase64: string,
): string {
  const bodyBuffer = Buffer.from(JSON.stringify(body));
  const secret = Buffer.from(secretKeyBase64, "base64");
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(timestamp);
  hmac.update(method);
  hmac.update(url);
  hmac.update(bodyBuffer);
  return hmac.digest("base64url");
}
