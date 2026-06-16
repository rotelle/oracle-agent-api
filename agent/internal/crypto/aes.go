package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jrti/oracle-query-agent/internal/model"
)

// DeriveKey derives a 32-byte AES-256 key from apiKey using SHA-256.
// Must match the TypeScript implementation in api/lib/crypto.ts.
func DeriveKey(apiKey string) []byte {
	hash := sha256.Sum256([]byte(apiKey))
	return hash[:]
}

// DecryptCredentials decrypts a base64 payload in the format "iv:authTag:ciphertext"
// produced by the API's encryptCredentials function.
func DecryptCredentials(encrypted string, apiKey string) (*model.OracleCredentials, error) {
	parts := strings.SplitN(encrypted, ":", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid encrypted payload: expected 3 colon-separated parts, got %d", len(parts))
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid iv: %w", err)
	}

	authTag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid authTag: %w", err)
	}

	ciphertext, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid ciphertext: %w", err)
	}

	key := DeriveKey(apiKey)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// GCM expects ciphertext+authTag concatenated
	combined := append(ciphertext, authTag...)
	plaintext, err := gcm.Open(nil, iv, combined, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed (wrong key or tampered data): %w", err)
	}

	var creds model.OracleCredentials
	if err := json.Unmarshal(plaintext, &creds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal credentials: %w", err)
	}

	return &creds, nil
}
