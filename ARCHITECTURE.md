# ARCHITECTURE.md — JRTi Oracle Query

## 1. Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        NUVEM (Render)                           │
│                                                                 │
│   ┌─────────────────┐          ┌──────────────────────────┐    │
│   │  App Relatório  │─────────►│     API Next.js          │    │
│   │  (qualquer      │  POST    │     /api/query           │    │
│   │   origem)       │◄─────────│                          │    │
│   └─────────────────┘  JSON   │  - Valida api_key        │    │
│                                │  - Gerencia WebSocket    │    │
│                                │  - Suspende conexão HTTP │    │
│                                │  - Criptografa credenciais│   │
│                                └──────────┬───────────────┘    │
└───────────────────────────────────────────┼────────────────────┘
                                            │ wss:// WebSocket
                                            │ (agente inicia)
┌───────────────────────────────────────────┼────────────────────┐
│                   WINDOWS LOCAL           │                     │
│                                           │                     │
│   ┌───────────────────────────────────────▼───────────────┐    │
│   │              jrti-oracle-query.exe                    │    │
│   │                                                       │    │
│   │  - Conecta e autentica na API                        │    │
│   │  - Recebe e descriptografa credenciais Oracle        │    │
│   │  - Executa SELECTs no Oracle                         │    │
│   │  - Normaliza dados (datas, números)                  │    │
│   │  - Reconecta automaticamente                         │    │
│   │  - Envia ping a cada 10min                           │    │
│   └───────────────────────────┬───────────────────────────┘    │
│                               │ TCP local                       │
│   ┌───────────────────────────▼───────────────────────────┐    │
│   │                  Oracle 10g                           │    │
│   └───────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Stack Tecnológica

### 2.1 API (Nuvem)
| Item | Escolha | Motivo |
|---|---|---|
| Framework | Next.js 14+ com App Router | TypeScript nativo, suporte a servidor customizado |
| Linguagem | TypeScript | Tipagem forte, melhor manutenção |
| WebSocket | biblioteca `ws` | Leve, estável, compatível com Node.js customizado |
| Servidor | Next.js com servidor Node customizado | Permite WebSocket + HTTP no mesmo processo |
| Hospedagem | Render (free tier) | Sem limite de timeout HTTP, sem cartão de crédito |
| Criptografia | AES-256-GCM (nativo Node.js `crypto`) | Sem dependências extras |

### 2.2 Agente (Windows)
| Item | Escolha | Motivo |
|---|---|---|
| Linguagem | Go 1.21+ | Compila em `.exe` único, sem dependências externas visíveis |
| Oracle driver | `godror` | Melhor suporte a Oracle com Go |
| Oracle client | Oracle Instant Client 19c | Compatível com Oracle 10g via protocolo legado |
| WebSocket | `gorilla/websocket` | Mais completo e estável para Go |
| Criptografia | AES-256-GCM (nativo Go `crypto/aes`) | Mesmo algoritmo da API |

---

## 3. Estrutura de Pastas

```
jrti-oracle-query/
├── SPEC.md
├── ARCHITECTURE.md
├── TASKS.md
│
├── api/                          → Aplicação Next.js
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── server.ts                 → Servidor Node customizado (HTTP + WebSocket)
│   ├── .env.example              → Exemplo de variáveis de ambiente
│   │
│   └── src/
│       ├── app/
│       │   └── api/
│       │       └── query/
│       │           └── route.ts  → Endpoint POST /api/query
│       │
│       └── lib/
│           ├── agent-manager.ts  → Gerencia conexão WebSocket com o agente
│           ├── query-manager.ts  → Gerencia fila de Promises pendentes
│           ├── crypto.ts         → Criptografia AES-256-GCM das credenciais
│           └── validator.ts      → Validação do JSON de entrada
│
└── agent/                        → Aplicação Go
    ├── go.mod
    ├── go.sum
    ├── main.go                   → Ponto de entrada, CLI args, loop principal
    │
    └── internal/
        ├── websocket/
        │   └── client.go         → Conexão WebSocket, reconexão, ping/pong
        ├── oracle/
        │   └── executor.go       → Conexão Oracle, execução de queries, normalização
        ├── crypto/
        │   └── aes.go            → Descriptografia AES-256-GCM
        └── model/
            └── messages.go       → Structs das mensagens WebSocket
```

---

## 4. Protocolo de Mensagens WebSocket

Todas as mensagens trafegam como JSON com um campo `type` identificador.

### 4.1 API → Agente

#### Credenciais Oracle (enviadas logo após conexão)
```json
{
  "type": "credentials",
  "data": "<payload AES-256-GCM em base64>"
}
```
O payload descriptografado contém:
```json
{
  "host": "localhost",
  "port": "1521",
  "service": "ORCL",
  "user": "usuario",
  "password": "senha"
}
```

#### Consulta SQL
```json
{
  "type": "query",
  "query_id": "abc-123",
  "sql": "SELECT id, nome FROM pedidos",
  "params": [],
  "timeout_ms": 300000
}
```

#### Resposta ao ping
```json
{
  "type": "pong"
}
```

### 4.2 Agente → API

#### Autenticação (primeira mensagem ao conectar)
```json
{
  "type": "auth",
  "key": "sk_a3f8c21d7b4e4a1c9e2d"
}
```

#### Keep-alive
```json
{
  "type": "ping"
}
```

#### Resultado de consulta
```json
{
  "type": "result",
  "query_id": "abc-123",
  "status": "success",
  "columns": [...],
  "rows": [...],
  "row_count": 1,
  "duration_ms": 84
}
```

#### Erro de consulta
```json
{
  "type": "result",
  "query_id": "abc-123",
  "status": "error",
  "error": {
    "code": "ORA-00942",
    "message": "table or view does not exist"
  },
  "duration_ms": 12
}
```

---

## 5. Fluxo de Autenticação e Criptografia

```
Agente conecta via wss://
        │
        │ envia: { type: "auth", key: "sk_..." }
        ▼
API valida key contra AGENT_API_KEY
        │
        ├── inválida → fecha WebSocket com código 4001
        │
        └── válida →
                │
                │ criptografa credenciais Oracle com AES-256-GCM
                │ usando AGENT_API_KEY como material da chave (SHA-256)
                │
                │ envia: { type: "credentials", data: "<base64>" }
                ▼
        Agente descriptografa em memória
        Agente pronto para executar queries
```

---

## 6. Gerenciamento de Queries Pendentes (API)

A API mantém em memória um `Map` de Promises pendentes:

```typescript
// query-manager.ts
const pendingQueries = new Map<string, {
  resolve: (result: QueryResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}>()
```

Ciclo de vida de uma query:
1. POST chega → Promise criada → entra no Map com `query_id`
2. Timer de timeout iniciado
3. Resultado chega via WebSocket → Promise resolvida → sai do Map
4. Timeout estoura → Promise rejeitada → sai do Map
5. Agente desconecta → todas as Promises rejeitadas com `AGENT_DISCONNECTED`

---

## 7. Reconexão do Agente (Backoff Exponencial)

```
Tentativa 1  →  aguarda  1s
Tentativa 2  →  aguarda  2s
Tentativa 3  →  aguarda  4s
Tentativa 4  →  aguarda  8s
Tentativa 5  →  aguarda 16s
Tentativa 6+ →  aguarda 30s (teto máximo)
Reconectou   →  reseta contador
```

A cada reconexão bem-sucedida a API reenvia as credenciais Oracle automaticamente.

---

## 8. Variáveis de Ambiente

### 8.1 API — Render
```env
AGENT_API_KEY=sk_...        # Chave de autenticação e base para criptografia AES
ORACLE_HOST=192.168.1.10    # IP ou hostname do servidor Oracle
ORACLE_PORT=1521            # Porta do listener Oracle
ORACLE_SERVICE=ORCL         # Nome do serviço Oracle
ORACLE_USER=usuario         # Usuário do banco
ORACLE_PASSWORD=senha       # Senha do banco
```

### 8.2 Agente — linha de comando
```bash
jrti-oracle-query.exe --key=sk_... --url=wss://sua-api.render.com
```

---

## 9. Servidor Node Customizado

A API usa um servidor Node.js customizado (`server.ts`) em vez do servidor padrão do Next.js para suportar WebSocket no mesmo processo:

```
server.ts
  ├── cria servidor HTTP
  ├── passa requisições HTTP para o Next.js handler
  └── faz upgrade de conexões WebSocket para o agent-manager
```

Isso permite que WebSocket e HTTP coexistam na mesma porta (443 no Render).

---

## 10. Instalação como Serviço Windows (Produção)

```bash
# Instalar
sc create JRTiOracleQuery binPath= "C:\jrti\jrti-oracle-query.exe --key=sk_... --url=wss://sua-api.render.com" start= auto

# Iniciar
sc start JRTiOracleQuery

# Parar
sc stop JRTiOracleQuery

# Remover
sc delete JRTiOracleQuery
```

---

## 11. Dependências Externas Necessárias

### Windows (para compilar o agente)
- Go 1.21+
- Oracle Instant Client 19c (necessário para o `godror`)
- Variável de ambiente `LD_LIBRARY_PATH` apontando para o Instant Client

### Render (para a API)
- Node.js 20+ (provido automaticamente pelo Render)
- Nenhuma instalação manual necessária
