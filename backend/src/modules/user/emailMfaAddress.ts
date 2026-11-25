import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function sealMfaAddress(key: Buffer, userId: string, email: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("bantai:email-mfa:" + userId));
  const encrypted = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")].join(".");
}

export function openMfaAddress(key: Buffer, userId: string, envelope: string) {
  const [version, nonce, tag, data, extra] = envelope.split(".");
  if (version !== "v1" || !nonce || !tag || !data || extra !== undefined) {
    throw new Error("Invalid encrypted MFA address.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from("bantai:email-mfa:" + userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}


export function openMfaAddressWithPreviousKey(
  key: Buffer, previousKey: Buffer | undefined, userId: string, envelope: string,
) {
  try {
    return openMfaAddress(key, userId, envelope);
  } catch (error) {
    if (!previousKey) throw error;
    return openMfaAddress(previousKey, userId, envelope);
  }
}
