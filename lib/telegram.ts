import crypto from "crypto";

export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Verifies Telegram Mini App `initData` per the official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * NEVER trust a telegram_id sent as plain JSON from the client — always
 * verify the raw initData string here, server-side, first. This is what
 * stops anyone from calling /api/generate pretending to be a different
 * user and draining someone else's daily quota.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): { ok: boolean; user?: TelegramWebAppUser; reason?: string } {
  if (!initData) return { ok: false, reason: "empty initData" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return { ok: false, reason: "signature mismatch" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: "initData expired" };
  }

  const userRaw = params.get("user");
  const user = userRaw ? (JSON.parse(userRaw) as TelegramWebAppUser) : undefined;

  return { ok: true, user };
}
