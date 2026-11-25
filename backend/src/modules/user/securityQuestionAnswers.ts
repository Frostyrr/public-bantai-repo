import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const normalizeAnswer = (answer: string) =>
  answer.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export async function hashAnswer(answer: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(normalizeAnswer(answer), salt, 64)) as Buffer;
  return `scrypt:${salt}:${digest.toString("hex")}`;
}
export async function checkAnswer(answer: string, stored: string) {
  const [version, salt, expected] = stored.split(":");
  if (
    version !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(expected ?? "")
  )
    return false;
  const digest = (await scrypt(normalizeAnswer(answer), salt, 64)) as Buffer;
  return timingSafeEqual(digest, Buffer.from(expected, "hex"));
}
