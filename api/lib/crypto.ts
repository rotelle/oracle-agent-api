import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { OracleCredentials } from "./types";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function deriveKey(apiKey: string): Buffer {
  return createHash("sha256").update(apiKey).digest();
}

export function encryptCredentials(credentials: OracleCredentials, apiKey: string): string {
  const key = deriveKey(apiKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptCredentials(encrypted: string, apiKey: string): OracleCredentials {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");

  const key = deriveKey(apiKey);
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as OracleCredentials;
}
