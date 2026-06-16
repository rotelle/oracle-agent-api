package model

// AuthMessage is the first message sent by the agent upon connecting.
type AuthMessage struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// PingMessage is sent by the agent every 10 minutes to keep the connection alive.
type PingMessage struct {
	Type string `json:"type"`
}

// PongMessage is the API's response to a ping.
type PongMessage struct {
	Type string `json:"type"`
}

// CredentialsMessage carries AES-256-GCM-encrypted Oracle credentials from the API.
type CredentialsMessage struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

// OracleCredentials holds plaintext Oracle connection details (kept only in memory).
type OracleCredentials struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	Service  string `json:"service"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// QueryMessage is sent by the API when a SQL query needs to be executed.
type QueryMessage struct {
	Type      string        `json:"type"`
	QueryID   string        `json:"query_id"`
	SQL       string        `json:"sql"`
	Params    []interface{} `json:"params"`
	TimeoutMs int64         `json:"timeout_ms"`
}

// ColumnInfo describes a result column.
type ColumnInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// QueryErrorDetail carries Oracle error details.
type QueryErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ResultMessage is sent by the agent after executing a query.
type ResultMessage struct {
	Type       string                   `json:"type"`
	QueryID    string                   `json:"query_id"`
	Status     string                   `json:"status"`
	Columns    []ColumnInfo             `json:"columns,omitempty"`
	Rows       []map[string]interface{} `json:"rows,omitempty"`
	RowCount   int                      `json:"row_count,omitempty"`
	DurationMs int64                    `json:"duration_ms"`
	Error      *QueryErrorDetail        `json:"error,omitempty"`
}

// IncomingMessage is used to detect the type of a raw WebSocket message.
type IncomingMessage struct {
	Type string `json:"type"`
}
