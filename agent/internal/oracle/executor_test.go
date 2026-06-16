package oracle

import (
	"fmt"
	"testing"
	"time"
)

func TestNormalizeDateValue(t *testing.T) {
	ts := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	got := normalizeDateValue(ts)
	want := "15/01/2026"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestNormalizeTimestampValue(t *testing.T) {
	ts := time.Date(2026, 1, 15, 14, 32, 0, 0, time.UTC)
	got := normalizeTimestampValue(ts)
	want := "15/01/2026 14:32:00"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestNormalizeNumberValue_Integer(t *testing.T) {
	result := normalizeNumberValue(42.0, true, 0)
	if v, ok := result.(int64); !ok || v != 42 {
		t.Errorf("got %v (%T), want int64(42)", result, result)
	}
}

func TestNormalizeNumberValue_Decimal(t *testing.T) {
	result := normalizeNumberValue(1000.05, true, 2)
	if v, ok := result.(float64); !ok || v != 1000.05 {
		t.Errorf("got %v (%T), want float64(1000.05)", result, result)
	}
}

func TestExtractOraError_KnownCode(t *testing.T) {
	err := fmt.Errorf("ORA-00942: table or view does not exist")
	code, _ := extractOraError(err)
	if code != "ORA-00942" {
		t.Errorf("got code %q, want ORA-00942", code)
	}
}

func TestExtractOraError_UnknownError(t *testing.T) {
	err := fmt.Errorf("some other error")
	code, _ := extractOraError(err)
	if code != "DB_ERROR" {
		t.Errorf("got code %q, want DB_ERROR", code)
	}
}
