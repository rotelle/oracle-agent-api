import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(apiKey) {
  return createHash("sha256").update(apiKey).digest();
}

function encryptCredentials(credentials, apiKey) {
  const key = deriveKey(apiKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptCredentials(encrypted, apiKey) {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");
  const key = deriveKey(apiKey);
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

const SAMPLE = {
  host: "192.168.1.10",
  port: "1521",
  service: "ORCL",
  user: "usuario",
  password: "senha_secreta",
};

test("encrypt then decrypt returns original credentials", () => {
  const apiKey = "sk_test_key_for_unit_tests";
  const encrypted = encryptCredentials(SAMPLE, apiKey);
  const decrypted = decryptCredentials(encrypted, apiKey);
  assert.deepEqual(decrypted, SAMPLE);
});

test("encrypted payload has three colon-separated parts (iv:authTag:ciphertext)", () => {
  const encrypted = encryptCredentials(SAMPLE, "sk_test");
  const parts = encrypted.split(":");
  assert.equal(parts.length, 3);
  for (const part of parts) {
    assert.ok(part.length > 0);
  }
});

test("two encryptions of the same data produce different ciphertexts (random IV)", () => {
  const apiKey = "sk_test";
  const a = encryptCredentials(SAMPLE, apiKey);
  const b = encryptCredentials(SAMPLE, apiKey);
  assert.notEqual(a, b);
});

test("decryption with wrong key throws", () => {
  const encrypted = encryptCredentials(SAMPLE, "sk_correct");
  assert.throws(() => decryptCredentials(encrypted, "sk_wrong"));
});

test("tampered ciphertext throws authentication error", () => {
  const encrypted = encryptCredentials(SAMPLE, "sk_test");
  const parts = encrypted.split(":");
  const tampered = Buffer.from(parts[2], "base64");
  tampered[0] ^= 0xff;
  const tamperedPayload = [parts[0], parts[1], tampered.toString("base64")].join(":");
  assert.throws(() => decryptCredentials(tamperedPayload, "sk_test"));
});
