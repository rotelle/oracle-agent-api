package crypto_test

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	agentcrypto "github.com/jrti/oracle-query-agent/internal/crypto"
	"github.com/jrti/oracle-query-agent/internal/model"
)

// encryptForTest mirrors the TypeScript encryptCredentials so we can generate
// test payloads without depending on the API binary.
func encryptForTest(creds model.OracleCredentials, apiKey string) (string, error) {
	key := agentcrypto.DeriveKey(apiKey)
	plaintext, err := json.Marshal(creds)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}

	sealed := gcm.Seal(nil, iv, plaintext, nil)
	// GCM appends authTag at the end; split at len(sealed)-16
	ciphertext := sealed[:len(sealed)-16]
	authTag := sealed[len(sealed)-16:]

	parts := []string{
		base64.StdEncoding.EncodeToString(iv),
		base64.StdEncoding.EncodeToString(authTag),
		base64.StdEncoding.EncodeToString(ciphertext),
	}
	return strings.Join(parts, ":"), nil
}

var sampleCreds = model.OracleCredentials{
	Host:     "192.168.1.10",
	Port:     "1521",
	Service:  "ORCL",
	User:     "usuario",
	Password: "senha_secreta",
}

func TestDecryptCredentials_RoundTrip(t *testing.T) {
	const apiKey = "sk_test_key_for_unit_tests"
	encrypted, err := encryptForTest(sampleCreds, apiKey)
	if err != nil {
		t.Fatalf("encryptForTest: %v", err)
	}
	got, err := agentcrypto.DecryptCredentials(encrypted, apiKey)
	if err != nil {
		t.Fatalf("DecryptCredentials: %v", err)
	}
	if *got != sampleCreds {
		t.Errorf("expected %+v, got %+v", sampleCreds, *got)
	}
}

func TestDecryptCredentials_WrongKey(t *testing.T) {
	encrypted, err := encryptForTest(sampleCreds, "sk_correct")
	if err != nil {
		t.Fatalf("encryptForTest: %v", err)
	}
	_, err = agentcrypto.DecryptCredentials(encrypted, "sk_wrong")
	if err == nil {
		t.Error("expected error with wrong key, got nil")
	}
}

func TestDecryptCredentials_TamperedCiphertext(t *testing.T) {
	const apiKey = "sk_test"
	encrypted, err := encryptForTest(sampleCreds, apiKey)
	if err != nil {
		t.Fatalf("encryptForTest: %v", err)
	}
	parts := strings.SplitN(encrypted, ":", 3)
	ciphertext, _ := base64.StdEncoding.DecodeString(parts[2])
	ciphertext[0] ^= 0xff
	parts[2] = base64.StdEncoding.EncodeToString(ciphertext)
	tampered := strings.Join(parts, ":")

	_, err = agentcrypto.DecryptCredentials(tampered, apiKey)
	if err == nil {
		t.Error("expected error with tampered ciphertext, got nil")
	}
}

func TestDecryptCredentials_InvalidFormat(t *testing.T) {
	_, err := agentcrypto.DecryptCredentials("notvalid", "sk_test")
	if err == nil {
		t.Error("expected error for invalid format, got nil")
	}
}
