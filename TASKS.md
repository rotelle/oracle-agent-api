# TASKS.md — JRTi Oracle Query

> **Instruções para o Claude Code:**
> - Marque cada tarefa com `[x]` ao concluí-la
> - Siga a ordem das fases — cada fase depende da anterior
> - Código-fonte e comentários em Inglês
> - Ao iniciar uma tarefa, leia SPEC.md e ARCHITECTURE.md antes de implementar

---

## FASE 1 — Estrutura inicial do projeto

### 1.1 Raiz do projeto
- [x] Criar `.gitignore` na raiz cobrindo Node.js, Go, variáveis de ambiente e binários
- [x] Criar `README.md` na raiz com visão geral do projeto, estrutura de pastas e link para os arquivos SDD

### 1.2 API — Scaffolding Next.js
- [x] Inicializar projeto Next.js 14+ com TypeScript em `api/` usando App Router
- [x] Instalar dependências: `ws`, `@types/ws`
- [x] Criar `api/.env.example` com todas as variáveis de ambiente necessárias e descrição de cada uma
- [x] Configurar `api/tsconfig.json` para incluir `server.ts` fora da pasta `src/`
- [x] Criar `api/next.config.ts` com configurações básicas
- [x] Criar estrutura de pastas: `app/api/query/`, `lib/`

### 1.3 Agente — Scaffolding Go
- [x] Inicializar módulo Go em `agent/` com `go mod init github.com/jrti/oracle-query-agent`
- [x] Adicionar dependências: `gorilla/websocket`, `godror`
- [x] Criar estrutura de pastas: `internal/websocket/`, `internal/oracle/`, `internal/crypto/`, `internal/model/`

---

## FASE 2 — Modelos e tipos compartilhados

### 2.1 API — Tipos TypeScript
- [x] Criar `lib/types.ts` com interfaces:
  - `QueryRequest` (campos: `api_key`, `query_id`, `sql`, `params`, `timeout_ms`)
  - `QueryResult` (campos: `query_id`, `status`, `columns`, `rows`, `row_count`, `duration_ms`)
  - `QueryError` (campos: `query_id`, `status`, `error.code`, `error.message`, `duration_ms`)
  - `ColumnInfo` (campos: `name`, `type`)
  - `WsMessage` (campo `type` e campos opcionais para cada tipo de mensagem)
  - `OracleCredentials` (campos: `host`, `port`, `service`, `user`, `password`)

### 2.2 Agente — Structs Go
- [x] Criar `internal/model/messages.go` com structs:
  - `AuthMessage` (campos: `Type`, `Key`)
  - `PingMessage` (campo: `Type`)
  - `PongMessage` (campo: `Type`)
  - `CredentialsMessage` (campos: `Type`, `Data`)
  - `OracleCredentials` (campos: `Host`, `Port`, `Service`, `User`, `Password`)
  - `QueryMessage` (campos: `Type`, `QueryID`, `SQL`, `Params`, `TimeoutMs`)
  - `ResultMessage` (campos: `Type`, `QueryID`, `Status`, `Columns`, `Rows`, `RowCount`, `DurationMs`, `Error`)
  - `ColumnInfo` (campos: `Name`, `Type`)
  - `QueryErrorDetail` (campos: `Code`, `Message`)

---

## FASE 3 — Criptografia

### 3.1 API — Módulo de criptografia
- [x] Criar `lib/crypto.ts`
- [x] Implementar função `deriveKey(apiKey: string): Buffer` que deriva chave AES-256 a partir da `AGENT_API_KEY` usando SHA-256
- [x] Implementar função `encryptCredentials(credentials: OracleCredentials, apiKey: string): string` usando AES-256-GCM com IV aleatório, retornando base64 no formato `iv:authTag:ciphertext`
- [x] Implementar função `decryptCredentials(encrypted: string, apiKey: string): OracleCredentials` para uso em testes
- [x] Escrever testes unitários para criptografia: cifrar e decifrar deve retornar o valor original (5/5 passando)

### 3.2 Agente — Módulo de criptografia
- [x] Criar `internal/crypto/aes.go`
- [x] Implementar função `DeriveKey(apiKey string) []byte` usando SHA-256 (mesma lógica da API)
- [x] Implementar função `DecryptCredentials(encrypted string, apiKey string) (*model.OracleCredentials, error)` que lê base64 no formato `iv:authTag:ciphertext` e descriptografa com AES-256-GCM
- [x] Escrever teste unitário: descriptografar payload gerado pela API deve retornar credenciais corretas

---

## FASE 4 — Validação de entrada (API)

- [x] Criar `lib/validator.ts`
- [x] Implementar função `validateQueryRequest(body: unknown): QueryRequest` que:
  - Verifica se `api_key` está presente e é string não vazia
  - Verifica se `query_id` está presente e é string não vazia
  - Verifica se `sql` está presente, é string não vazia e começa com `SELECT` (case-insensitive)
  - Define `params` como `[]` se ausente
  - Define `timeout_ms` como `300000` se ausente
  - Garante que `timeout_ms` está entre `5000` e `300000`
  - Lança erro tipado `ValidationError` com mensagem descritiva em caso de falha
- [x] Implementar função `validateApiKey(apiKey: string): boolean` que compara com `process.env.AGENT_API_KEY`

---

## FASE 5 — Gerenciador de queries pendentes (API)

- [x] Criar `lib/query-manager.ts`
- [x] Implementar classe `QueryManager` com:
  - `Map` interno `pending` tipado com `query_id` como chave
  - Método `register(queryId: string, timeoutMs: number): Promise<QueryResult>` que:
    - Cria Promise e armazena `resolve`, `reject` e timer no Map
    - Timer rejeita com erro `TIMEOUT` ao expirar e remove do Map
    - Retorna a Promise
  - Método `resolve(result: ResultPayload): void` que:
    - Busca a Promise pelo `query_id`
    - Cancela o timer
    - Resolve ou rejeita a Promise conforme `status`
    - Remove do Map
  - Método `rejectAll(code: string, message: string): void` que:
    - Rejeita todas as Promises pendentes com o código e mensagem fornecidos
    - Cancela todos os timers
    - Limpa o Map
  - Método `hasPending(queryId: string): boolean`
- [x] Exportar instância singleton de `QueryManager`

---

## FASE 6 — Gerenciador do agente WebSocket (API)

- [x] Criar `lib/agent-manager.ts`
- [x] Implementar classe `AgentManager` com:
  - Propriedade `connected: boolean`
  - Referência para o WebSocket do agente conectado (apenas um agente por vez)
  - Método `handleConnection(ws: WebSocket): void` que:
    - Lê primeira mensagem esperando `{ type: "auth", key: "..." }`
    - Valida a chave contra `process.env.AGENT_API_KEY`
    - Fecha com código `4001` se inválida
    - Se válida: marca como conectado, envia credenciais criptografadas
    - Registra handler para mensagens recebidas
    - Registra handler para fechamento/erro: marca como desconectado, chama `queryManager.rejectAll("AGENT_DISCONNECTED", ...)`
  - Método `sendQuery(query: QueryRequest): boolean` que:
    - Retorna `false` se agente não conectado
    - Envia JSON via WebSocket
    - Retorna `true`
  - Método `handleMessage(raw: string): void` que:
    - Faz parse do JSON
    - Se `type === "ping"`: responde com `{ type: "pong" }`
    - Se `type === "result"`: chama `queryManager.resolve(message)`
  - Método `buildCredentialsPayload(): string` que monta e criptografa as credenciais Oracle a partir das variáveis de ambiente
- [x] Exportar instância singleton de `AgentManager`

---

## FASE 7 — Servidor customizado (API)

- [x] Criar `api/server.ts`
- [x] Criar servidor HTTP nativo do Node.js
- [x] Instanciar `WebSocket.Server` sem porta própria (modo `noServer`)
- [x] Configurar upgrade de conexões HTTP para WebSocket na rota `/agent`
- [x] Passar todas as outras requisições HTTP para o handler do Next.js
- [x] Iniciar o servidor na porta definida por `process.env.PORT` ou `3000`
- [x] Logar no console quando o servidor estiver pronto
- [x] Atualizar `package.json` para usar `ts-node server.ts` no script `start` e `dev`

---

## FASE 8 — Endpoint de consulta (API)

- [ ] Criar `src/app/api/query/route.ts`
- [ ] Implementar handler `POST`:
  - Fazer parse do body como JSON
  - Chamar `validateQueryRequest(body)` — retornar erro `400` com `INVALID_REQUEST` se falhar
  - Chamar `validateApiKey(body.api_key)` — retornar erro `401` com `UNAUTHORIZED` se falhar
  - Verificar `agentManager.connected` — retornar erro `503` com `AGENT_OFFLINE` se falso
  - Registrar query no `queryManager.register(query_id, timeout_ms)`
  - Enviar query ao agente via `agentManager.sendQuery(...)`
  - Aguardar a Promise (conexão suspensa)
  - Retornar resultado com status `200`
  - Capturar erros: retornar status `504` para `TIMEOUT`, `503` para `AGENT_DISCONNECTED`, `500` para outros
- [ ] Garantir que todos os erros retornam JSON no formato definido na SPEC

---

## FASE 9 — Cliente WebSocket do agente (Go)

- [ ] Criar `internal/websocket/client.go`
- [ ] Implementar struct `Client` com campos:
  - `url string`
  - `apiKey string`
  - `conn *websocket.Conn`
  - `credentials *model.OracleCredentials`
  - `onQuery func(msg model.QueryMessage)`
  - `reconnectDelay time.Duration`
- [ ] Implementar método `Connect() error` que:
  - Abre conexão WebSocket com a URL
  - Envia mensagem de autenticação `{ type: "auth", key: "..." }`
  - Aguarda mensagem de credenciais `{ type: "credentials", data: "..." }`
  - Descriptografa e armazena credenciais em memória
  - Inicia goroutine de leitura de mensagens
  - Inicia goroutine de keep-alive (ping a cada 10 minutos)
- [ ] Implementar método `readLoop()` (goroutine) que:
  - Lê mensagens em loop
  - Roteia por `type`: `query` → chama `onQuery`, `pong` → registra recebimento do pong
  - Em caso de erro: encerra goroutine e sinaliza desconexão
- [ ] Implementar método `pingLoop()` (goroutine) que:
  - Envia `{ type: "ping" }` a cada 10 minutos
  - Aguarda `pong` por até 15 segundos
  - Se não receber `pong`: fecha conexão e sinaliza desconexão
- [ ] Implementar método `SendResult(result model.ResultMessage) error`
- [ ] Implementar método `RunWithReconnect(ctx context.Context)` que:
  - Chama `Connect()` em loop
  - Em caso de falha: aplica backoff exponencial (1s, 2s, 4s, 8s, 16s, teto 30s)
  - Reseta delay ao reconectar com sucesso
  - Para quando contexto for cancelado

---

## FASE 10 — Executor Oracle (Go)

- [ ] Criar `internal/oracle/executor.go`
- [ ] Implementar struct `Executor` com campo `db *sql.DB`
- [ ] Implementar função `NewExecutor(credentials *model.OracleCredentials) (*Executor, error)` que:
  - Monta connection string Oracle no formato `user/password@host:port/service`
  - Abre pool de conexões com `sql.Open("godror", connStr)`
  - Valida conexão com `db.Ping()`
  - Retorna `Executor` pronto
- [ ] Implementar método `Execute(ctx context.Context, query model.QueryMessage) model.ResultMessage` que:
  - Registra `time.Now()` para calcular `duration_ms`
  - Executa query com `db.QueryContext(ctx, sql, params...)`
  - Em caso de erro SQL: retorna `ResultMessage` com `status: "error"` e código `ORA-XXXXX` extraído da mensagem
  - Lê `rows.ColumnTypes()` para obter nome e tipo de cada coluna
  - Itera as linhas e escaneia valores como `interface{}`
  - Para cada valor, chama `normalizeValue(value, columnType)` antes de adicionar ao resultado
  - Retorna `ResultMessage` com `status: "success"`, colunas, linhas e contagens
- [ ] Implementar função `normalizeValue(value interface{}, colType *sql.ColumnType) interface{}` que:
  - Detecta tipo Oracle pela string de `colType.DatabaseTypeName()`
  - Para `DATE`: converte para string `"dd/mm/yyyy"`
  - Para `TIMESTAMP`: converte para string `"dd/mm/yyyy hh:mm:ss"`
  - Para `NUMBER`: retorna `int64` se sem escala, `float64` se com escala
  - Para `VARCHAR2`, `CHAR`, `CLOB`: retorna string
  - Para `nil`: retorna `nil`
- [ ] Implementar função `extractOraError(err error) (code string, message string)` que extrai código `ORA-XXXXX` da mensagem de erro do godror

---

## FASE 11 — Ponto de entrada do agente (Go)

- [ ] Criar `agent/main.go`
- [ ] Implementar parsing de argumentos de linha de comando:
  - `--key` → chave de autenticação (obrigatório)
  - `--url` → URL WebSocket da API (obrigatório)
  - Exibir mensagem de uso e encerrar com código 1 se algum argumento estiver ausente
- [ ] Configurar logger estruturado com timestamp para todos os eventos relevantes:
  - Tentativas de conexão
  - Conexão estabelecida
  - Credenciais recebidas
  - Query recebida (logar apenas `query_id`, nunca o SQL completo em produção)
  - Resultado enviado
  - Desconexão e tentativas de reconexão
- [ ] Instanciar `oracle.Executor` após receber credenciais
- [ ] Registrar callback `onQuery` no cliente WebSocket que:
  - Executa `executor.Execute(ctx, queryMessage)`
  - Envia resultado via `client.SendResult(result)`
- [ ] Capturar sinais `SIGINT` e `SIGTERM` para encerramento gracioso:
  - Logar encerramento
  - Fechar WebSocket com mensagem de fechamento
  - Fechar pool de conexões Oracle
- [ ] Chamar `client.RunWithReconnect(ctx)` como loop principal

---

## FASE 12 — Testes de integração

### 12.1 API
- [ ] Criar teste que simula agente conectado e verifica que POST em `/api/query` aguarda e retorna resultado
- [ ] Criar teste que verifica retorno `503` quando agente não está conectado
- [ ] Criar teste que verifica retorno `401` com `api_key` inválida
- [ ] Criar teste que verifica retorno `400` com JSON malformado
- [ ] Criar teste que verifica retorno `504` quando timeout estoura

### 12.2 Agente
- [ ] Criar teste que verifica reconexão automática após queda simulada
- [ ] Criar teste que verifica descriptografia correta das credenciais
- [ ] Criar teste que verifica normalização de datas Oracle para `dd/mm/yyyy`
- [ ] Criar teste que verifica normalização de números Oracle

---

## FASE 13 — Build e empacotamento

### 13.1 Agente Go
- [ ] Criar `agent/Makefile` com targets:
  - `build`: compila `jrti-oracle-query.exe` para Windows (GOOS=windows GOARCH=amd64)
  - `build-linux`: compila para Linux (para testes locais em Mac/Linux)
  - `test`: roda todos os testes
  - `clean`: remove binários gerados
- [ ] Verificar que o `.exe` gerado não tem dependências além do Oracle Instant Client
- [ ] Documentar no `agent/README.md` como instalar o Oracle Instant Client no Windows

### 13.2 API Next.js
- [ ] Verificar que `npm run build` completa sem erros
- [ ] Criar `api/render.yaml` com configurações de deploy:
  - Tipo de serviço web
  - Comando de build: `npm install && npm run build`
  - Comando de start: `npm start`
  - Variáveis de ambiente listadas (sem valores)
- [ ] Verificar que todas as variáveis de ambiente estão documentadas em `.env.example`

---

## FASE 14 — Documentação final

- [ ] Criar `agent/README.md` em Português do Brasil com:
  - Pré-requisitos (Go, Oracle Instant Client)
  - Como compilar o `.exe`
  - Como configurar variáveis de ambiente Oracle no Render
  - Como executar no terminal
  - Como instalar como serviço Windows
  - Como parar e remover o serviço
- [ ] Criar `api/README.md` em Português do Brasil com:
  - Pré-requisitos
  - Como configurar variáveis de ambiente no Render
  - Como fazer deploy no Render
  - Documentação do endpoint `POST /api/query` com exemplos de request e response
- [ ] Atualizar `README.md` da raiz com:
  - Diagrama ASCII da arquitetura
  - Passo a passo completo do zero ao funcionando
  - Link para os READMEs de cada aplicação
