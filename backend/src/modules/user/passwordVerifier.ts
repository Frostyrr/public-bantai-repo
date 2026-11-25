import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
// Changing these parameters requires a new format version.
const derive = (value: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(value, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(new Error("Password verification unavailable"));
    else resolve(key);
  });
});
const format = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
export async function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(value, salt)).toString("hex")}`;
}
export async function verifyPassword(value: string, encoded: string) {
  const match = format.exec(encoded);
  if (!match)
    throw new Error("Unsupported password verifier");
  return timingSafeEqual(await derive(value, match[1]), Buffer.from(match[2], "hex"));
}
export async function rejectReusedPassword(value: string, verifiers: unknown, version: number, tracked: number) {
  if (!Number.isSafeInteger(version) || version < 0 || !Number.isInteger(tracked) || !Array.isArray(verifiers) || verifiers.length !== tracked || tracked > 4 || tracked < 0 || (version > 0 && tracked === 0))
    throw new Error("Password history integrity failure");
  let reused = false;
  // Bound per-request memory instead of running four scrypt allocations together.
  for (const verifier of verifiers) {
    if (typeof verifier !== "string")
      throw new Error("Invalid password history");
    reused = (await verifyPassword(value, verifier)) || reused;
  }
  return reused;
}
