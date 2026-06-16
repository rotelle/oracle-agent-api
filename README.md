# JRTi Oracle Query

Ponte entre uma aplicação de relatórios na nuvem e um banco de dados Oracle 10g em servidor Windows local.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        NUVEM (Render)                           │
│                                                                 │
│   ┌─────────────────┐          ┌──────────────────────────┐    │
│   │  App Relatório  │─────────►│     API Next.js          │    │
│   │  (qualquer      │  POST    │     /api/query           │    │
│   │   origem)       │◄─────────│                          │    │
│   └─────────────────┘  JSON   └──────────┬───────────────┘    │
└───────────────────────────────────────────┼────────────────────┘
                                            │ wss:// WebSocket
                                            │ (agente inicia)
┌───────────────────────────────────────────┼────────────────────┐
│                   WINDOWS LOCAL           │                     │
│                                           │                     │
│   ┌───────────────────────────────────────▼───────────────┐    │
│   │              jrti-oracle-query.exe                    │    │
│   │  Agente Go — conecta à API, executa queries Oracle   │    │
│   └───────────────────────────┬───────────────────────────┘    │
│                               │ TCP local                       │
│   ┌───────────────────────────▼───────────────────────────┐    │
│   │                  Oracle 10g                           │    │
│   └───────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

---

## Estrutura do Repositório

```
jrti-oracle-query/
├── api/              → API Next.js (TypeScript) — hospedada no Render
│   ├── lib/          → crypto, validator, query-manager, agent-manager
│   ├── app/api/query/route.ts  → endpoint POST /api/query
│   ├── server.ts     → servidor HTTP + WebSocket customizado
│   └── render.yaml   → configuração de deploy no Render
│
├── agent/            → Agente Go — compilado em .exe para Windows
│   ├── internal/
│   │   ├── crypto/   → descriptografia AES-256-GCM
│   │   ├── model/    → structs de mensagens WebSocket
│   │   ├── oracle/   → executor de queries + normalização de dados
│   │   └── websocket/ → cliente WebSocket com reconexão automática
│   ├── main.go       → ponto de entrada, CLI, sinais de encerramento
│   └── Makefile      → targets build, build-linux, test, clean
│
├── SPEC.md           → especificação funcional
├── ARCHITECTURE.md   → arquitetura técnica detalhada
└── INSTRUCTIONS.md   → guia de integração para a aplicação de relatório
```

---

## Passo a Passo — Do Zero ao Funcionando

### Passo 1 — Gerar a chave de autenticação

```bash
openssl rand -hex 32
# Exemplo: sk_a3f8c21d7b4e4a1c9e2d8f3b2c1a0e9d
```

Guarde esse valor — ele será usado no Render e no agente.

### Passo 2 — Deploy da API no Render

1. Crie uma conta em [render.com](https://render.com)
2. New → Web Service → conecte seu repositório Git
3. **Root Directory:** `api`
4. Render detecta o `render.yaml` automaticamente
5. Configure as variáveis de ambiente:

   | Variável | Valor |
   |---|---|
   | `AGENT_API_KEY` | a chave gerada no Passo 1 |
   | `ORACLE_HOST` | IP do servidor Oracle |
   | `ORACLE_PORT` | `1521` |
   | `ORACLE_SERVICE` | nome do serviço (ex: `ORCL`) |
   | `ORACLE_USER` | usuário do banco |
   | `ORACLE_PASSWORD` | senha do banco |

6. Clique em **Deploy** — anote a URL gerada (ex: `https://jrti-oracle-query-api.onrender.com`)

### Passo 3 — Preparar Oracle Instant Client e compilar

Baixe o **Instant Client 19c Basic** para Windows x64 e coloque o zip na pasta `agent/`.  
Também é necessário ter [Go 1.21+](https://go.dev/dl/) e [MinGW-w64](https://www.mingw-w64.org/) (GCC) instalados e no PATH.

```bash
cd agent

# Extraia o zip na pasta agent/ (será criada instantclient_19_30/)
# Em seguida, gere o pacote portável:
go mod download
make dist
# Gera: dist/jrti-oracle-query.exe  +  dist/*.dll  (~217 MB)
```

O diretório `dist/` contém tudo que é necessário: basta copiá-lo para qualquer máquina Windows — **sem instalar Oracle Client no sistema**.

### Passo 4 — Executar o agente

Copie a pasta `agent/dist/` para a máquina Windows com Oracle. Execute dentro da pasta `dist/`:

**Modo terminal (desenvolvimento):**

```bat
jrti-oracle-query.exe --key=sk_a3f8c21d... --url=wss://jrti-oracle-query-api.onrender.com
```

**Modo serviço Windows (produção):**

```bat
sc create JRTiOracleQuery ^
  binPath= "C:\jrti\dist\jrti-oracle-query.exe --key=sk_... --url=wss://jrti-oracle-query-api.onrender.com" ^
  start= auto
sc start JRTiOracleQuery
```

> O agente encontra os DLLs Oracle automaticamente porque estão na mesma pasta do `.exe` — nenhuma configuração de PATH ou instalação de Oracle Client é necessária.

### Passo 5 — Testar a integração

```bash
curl -X POST https://jrti-oracle-query-api.onrender.com/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "sk_a3f8c21d...",
    "query_id": "test-001",
    "sql": "SELECT SYSDATE AS hoje FROM DUAL"
  }'
```

Resposta esperada:
```json
{
  "query_id": "test-001",
  "status": "success",
  "columns": [{ "name": "HOJE", "type": "DATE" }],
  "rows": [{ "HOJE": "16/06/2026" }],
  "row_count": 1,
  "duration_ms": 42
}
```

---

## Links de Documentação

- [api/README.md](api/README.md) — deploy da API, endpoint e testes
- [agent/README.md](agent/README.md) — compilação, instalação como serviço e testes Go
- [SPEC.md](SPEC.md) — especificação funcional completa
- [ARCHITECTURE.md](ARCHITECTURE.md) — arquitetura técnica detalhada
- [INSTRUCTIONS.md](INSTRUCTIONS.md) — guia SQL Oracle 10g para a aplicação de relatório
