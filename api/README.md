# jrti-oracle-query — API Next.js

API hospedada no Render que recebe consultas SQL da aplicação de relatório e as repassa ao agente Go via WebSocket.

---

## Pré-requisitos

- Conta no [Render](https://render.com) (free tier é suficiente)
- Node.js 20+ (provido automaticamente pelo Render)
- Agente Go rodando no servidor Windows com Oracle 10g

---

## 1. Configurar variáveis de ambiente no Render

No painel do seu serviço web, adicione as seguintes variáveis:

| Variável | Descrição |
|---|---|
| `AGENT_API_KEY` | Chave de autenticação — gerar com `openssl rand -hex 32` e usar o mesmo valor no agente |
| `ORACLE_HOST` | IP ou hostname do servidor Oracle (ex: `192.168.1.10`) |
| `ORACLE_PORT` | Porta do listener Oracle (padrão: `1521`) |
| `ORACLE_SERVICE` | Nome do serviço Oracle (ex: `ORCL`) |
| `ORACLE_USER` | Usuário do banco Oracle |
| `ORACLE_PASSWORD` | Senha do banco Oracle |

> As credenciais Oracle são enviadas ao agente **criptografadas** via WebSocket. Nunca ficam em disco no servidor Windows.

---

## 2. Fazer deploy no Render

### Opção A — render.yaml (recomendado)

O arquivo `render.yaml` na raiz de `api/` já está configurado. Basta:

1. Conectar o repositório no Render (New → Web Service → From a Git repo)
2. Apontar para a pasta `api/` como root directory
3. Render detectará o `render.yaml` automaticamente
4. Preencher as variáveis de ambiente marcadas como `sync: false`
5. Clicar em **Deploy**

### Opção B — configuração manual

| Campo | Valor |
|---|---|
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Node Version | 20 |
| Region | Oregon (ou a mais próxima) |

---

## 3. Endpoint `POST /api/query`

### Requisição

```
POST https://sua-api.render.com/api/query
Content-Type: application/json
```

```json
{
  "api_key": "sk_a3f8c21d7b4e4a1c9e2d",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "sql": "SELECT id, nome FROM pedidos WHERE ROWNUM <= 100",
  "params": [],
  "timeout_ms": 30000
}
```

| Campo | Obrigatório | Padrão | Descrição |
|---|---|---|---|
| `api_key` | ✅ | — | Deve ser igual ao `AGENT_API_KEY` configurado no Render |
| `query_id` | ✅ | — | UUID v4 único por requisição |
| `sql` | ✅ | — | Instrução SELECT para Oracle 10g |
| `params` | ❌ | `[]` | Parâmetros bind (`:1`, `:2`, ...) |
| `timeout_ms` | ❌ | `300000` | Mínimo: `5000`. Máximo: `300000` |

### Resposta — Sucesso

```json
{
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "columns": [
    { "name": "ID",   "type": "NUMBER" },
    { "name": "NOME", "type": "VARCHAR2" }
  ],
  "rows": [
    { "ID": 1, "NOME": "Pedido A" }
  ],
  "row_count": 1,
  "duration_ms": 84
}
```

### Resposta — Erro

```json
{
  "status": "error",
  "error": {
    "code": "AGENT_OFFLINE",
    "message": "Agent is not connected"
  }
}
```

### Códigos de erro HTTP

| Status | Código | Causa |
|---|---|---|
| `400` | `INVALID_REQUEST` | JSON inválido ou campos obrigatórios ausentes |
| `401` | `UNAUTHORIZED` | `api_key` inválida ou ausente |
| `503` | `AGENT_OFFLINE` | Agente Go não está conectado |
| `503` | `AGENT_DISCONNECTED` | Agente desconectou durante a execução |
| `504` | `TIMEOUT` | Sem resposta dentro do `timeout_ms` |
| `200` | `ORA-XXXXX` | Erro Oracle — retornado com status 200 para o cliente inspecionar |

---

## 4. Rodar localmente

```bash
cd api
cp .env.example .env.local
# Edite .env.local com suas credenciais Oracle

npm install
npm run dev
# Servidor disponível em http://localhost:3000
```

## 5. Rodar testes

```bash
cd api
npm test
# 20 testes: 5 crypto + 10 validação + 5 integração
```
