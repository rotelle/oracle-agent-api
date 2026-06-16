package oracle

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	_ "github.com/godror/godror"
	"github.com/jrti/oracle-query-agent/internal/model"
)

var oraErrorRe = regexp.MustCompile(`ORA-\d+`)

// Executor executes SELECT queries against an Oracle database.
type Executor struct {
	db *sql.DB
}

// NewExecutor opens a connection pool to Oracle and validates it with a ping.
func NewExecutor(credentials *model.OracleCredentials) (*Executor, error) {
	connStr := fmt.Sprintf(
		"%s/%s@%s:%s/%s",
		credentials.User,
		credentials.Password,
		credentials.Host,
		credentials.Port,
		credentials.Service,
	)

	db, err := sql.Open("godror", connStr)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}

	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping oracle: %w", err)
	}

	log.Println("[executor] Connected to Oracle")
	return &Executor{db: db}, nil
}

// Execute runs the query described in msg and returns a ResultMessage.
func (e *Executor) Execute(ctx context.Context, query model.QueryMessage) model.ResultMessage {
	start := time.Now()

	queryCtx, cancel := context.WithTimeout(ctx, time.Duration(query.TimeoutMs)*time.Millisecond)
	defer cancel()

	rows, err := e.db.QueryContext(queryCtx, query.SQL, query.Params...)
	if err != nil {
		code, message := extractOraError(err)
		return model.ResultMessage{
			Type:       "result",
			QueryID:    query.QueryID,
			Status:     "error",
			DurationMs: time.Since(start).Milliseconds(),
			Error:      &model.QueryErrorDetail{Code: code, Message: message},
		}
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return model.ResultMessage{
			Type:       "result",
			QueryID:    query.QueryID,
			Status:     "error",
			DurationMs: time.Since(start).Milliseconds(),
			Error:      &model.QueryErrorDetail{Code: "INTERNAL", Message: err.Error()},
		}
	}

	columns := make([]model.ColumnInfo, len(colTypes))
	for i, ct := range colTypes {
		columns[i] = model.ColumnInfo{Name: ct.Name(), Type: ct.DatabaseTypeName()}
	}

	var result []map[string]interface{}
	for rows.Next() {
		scanDest := make([]interface{}, len(colTypes))
		scanPtrs := make([]interface{}, len(colTypes))
		for i := range scanDest {
			scanPtrs[i] = &scanDest[i]
		}
		if err := rows.Scan(scanPtrs...); err != nil {
			return model.ResultMessage{
				Type:       "result",
				QueryID:    query.QueryID,
				Status:     "error",
				DurationMs: time.Since(start).Milliseconds(),
				Error:      &model.QueryErrorDetail{Code: "SCAN_ERROR", Message: err.Error()},
			}
		}
		row := make(map[string]interface{}, len(colTypes))
		for i, ct := range colTypes {
			row[ct.Name()] = normalizeValue(scanDest[i], ct)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		code, message := extractOraError(err)
		return model.ResultMessage{
			Type:       "result",
			QueryID:    query.QueryID,
			Status:     "error",
			DurationMs: time.Since(start).Milliseconds(),
			Error:      &model.QueryErrorDetail{Code: code, Message: message},
		}
	}

	if result == nil {
		result = []map[string]interface{}{}
	}

	return model.ResultMessage{
		Type:       "result",
		QueryID:    query.QueryID,
		Status:     "success",
		Columns:    columns,
		Rows:       result,
		RowCount:   len(result),
		DurationMs: time.Since(start).Milliseconds(),
	}
}

// Close shuts down the connection pool.
func (e *Executor) Close() {
	if e.db != nil {
		e.db.Close()
	}
}

func normalizeDateValue(t time.Time) string      { return t.Format("02/01/2006") }
func normalizeTimestampValue(t time.Time) string { return t.Format("02/01/2006 15:04:05") }

func normalizeNumberValue(value float64, hasScale bool, scale int64) interface{} {
	if hasScale && scale == 0 {
		return int64(value)
	}
	return value
}

// normalizeValue converts raw Oracle values to JSON-friendly types per SPEC §7.
func normalizeValue(value interface{}, colType *sql.ColumnType) interface{} {
	if value == nil {
		return nil
	}

	dbType := strings.ToUpper(colType.DatabaseTypeName())

	switch dbType {
	case "DATE":
		switch v := value.(type) {
		case time.Time:
			return normalizeDateValue(v)
		case string:
			if t, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
				return normalizeDateValue(t)
			}
			return v
		}
	case "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "TIMESTAMP WITH LOCAL TIME ZONE":
		switch v := value.(type) {
		case time.Time:
			return normalizeTimestampValue(v)
		case string:
			if t, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
				return normalizeTimestampValue(t)
			}
			return v
		}
	case "NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE":
		_, scale, ok := colType.DecimalSize()
		switch v := value.(type) {
		case int64:
			return normalizeNumberValue(float64(v), ok, scale)
		case float64:
			return normalizeNumberValue(v, ok, scale)
		}
	}

	// VARCHAR2, CHAR, CLOB, and anything else — return as-is (typically string or []byte)
	if b, ok := value.([]byte); ok {
		return string(b)
	}
	return value
}

// extractOraError extracts the ORA-XXXXX code from a godror error message.
func extractOraError(err error) (code string, message string) {
	msg := err.Error()
	if match := oraErrorRe.FindString(msg); match != "" {
		return match, msg
	}
	return "DB_ERROR", msg
}
