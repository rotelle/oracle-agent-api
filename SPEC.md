# SPEC.md — JRTi Oracle Query

## 1. Visão Geral

Sistema composto por duas aplicações que formam uma ponte entre uma aplicação de relatórios na nuvem e um banco de dados Oracle 10g em servidor Windows local.

---

## 2. Aplicações

### 2.1 API (`api/`)
- Aplicação Next.js + TypeScript hospedada no Render
- Recebe consultas SQL da aplicação de relatório via HTTP POST
- Mantém conexão WebSocket persistente com o agente Go
- Repassa consultas ao agente e devolve os resultados na mesma conexão HTTP
- Envia credenciais Oracle ao agente de forma criptografada via WebSocket
- Nunca acessa o Oracle diretamente

### 2.2 Agente Go (`agent/`)
- Aplicação Go compilada em único `.exe` para Windows
- Inicia e mantém conexão WebSocket com a API
- Recebe credenciais Oracle criptografadas da API e as mantém apenas em memória
- Executa consultas SQL no Oracle local
- Devolve resultados à API via WebSocket
- Envia ping a cada 10 minutos para manter o Render ativo

---

## 3. Fluxo Completo

### 3.1 Inicialização
1. Agente Go é iniciado com `--key` e `--url` na linha de comando
2. Agente conecta via WebSocket seguro (`wss://`) na API
3. API valida a `AGENT_API_KEY`
4. API envia credenciais Oracle criptografadas via WebSocket
5. Agente descriptografa as credenciais usando a `AGENT_API_KEY` como chave AES
6. Agente mantém credenciais apenas em memória
7. Sistema pronto para receber consultas

### 3.2 Consulta
1. Aplicação de relatório faz `POST /api/query` com JSON de consulta
2. API valida a `api_key` no corpo do JSON
3. API verifica se o agente está conectado
4. API registra a consulta como pendente (Promise suspensa)
5. API repassa o SQL ao agente via WebSocket
6. Agente executa o SELECT no Oracle local
7. Agente normaliza os dados (datas, números)
8. Agente envia resultado via WebSocket
9. API resolve a Promise e responde o POST original
10. Aplicação de relatório recebe o JSON na mesma conexão

### 3.3 Reconexão
1. Agente detecta queda da conexão (erro no ping, fechamento do WebSocket ou timeout de pong)
2. Agente tenta reconectar com backoff exponencial: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
3. Ao reconectar, API reenvia as credenciais Oracle criptografadas
4. Sistema volta ao normal automaticamente

---

## 4. Autenticação e Segurança

### 4.1 Chave da API (`AGENT_API_KEY`)
- Definida como variável de ambiente no Render
- Usada para duas finalidades:
  - Autenticar a conexão WebSocket do agente Go
  - Validar as requisições da aplicação de relatório (campo `api_key` no JSON)
- Usada como chave de criptografia AES para as credenciais Oracle

### 4.2 Credenciais Oracle
- Definidas como variáveis de ambiente no Render
- Enviadas ao agente criptografadas com AES via WebSocket no momento da conexão
- Nunca armazenadas em disco no servidor Windows
- Nunca trafegam em texto puro
- Mantidas apenas em memória no processo do agente

### 4.3 Variáveis de ambiente

#### Render (API)
| Variável | Descrição |
|---|---|
| `AGENT_API_KEY` | Chave de autenticação e criptografia |
| `ORACLE_HOST` | Host do servidor Oracle |
| `ORACLE_PORT` | Porta do Oracle (padrão: 1521) |
| `ORACLE_SERVICE` | Nome do serviço Oracle |
| `ORACLE_USER` | Usuário do Oracle |
| `ORACLE_PASSWORD` | Senha do Oracle |

#### Windows (Agente)
Nenhuma variável de ambiente necessária. Toda configuração é passada via linha de comando.

---

## 5. Interface de Linha de Comando do Agente

```bash
jrti-oracle-query.exe --key=<AGENT_API_KEY> --url=<WSS_URL>
```

| Argumento | Obrigatório | Descrição |
|---|---|---|
| `--key` | ✅ | Chave de autenticação (deve bater com `AGENT_API_KEY` do Render) |
| `--url` | ✅ | URL WebSocket da API (ex: `wss://sua-api.render.com`) |

---

## 6. Formato JSON

### 6.1 Consulta (Aplicação de Relatório → API)
```json
{
  "api_key": "sk_a3f8c21d7b4e4a1c9e2d",
  "query_id": "abc-123",
  "sql": "SELECT id, nome, valor FROM pedidos WHERE data >= :1",
  "params": ["01/01/2026"],
  "timeout_ms": 300000
}
```

| Campo | Obrigatório | Padrão | Descrição |
|---|---|---|---|
| `api_key` | ✅ | — | Chave de autenticação |
| `query_id` | ✅ | — | UUID gerado pela aplicação de relatório |
| `sql` | ✅ | — | Instrução SELECT a executar |
| `params` | ❌ | `[]` | Parâmetros bind para o Oracle |
| `timeout_ms` | ❌ | `300000` | Timeout em ms (mín: 5000, máx: 300000) |

### 6.2 Retorno — Sucesso
```json
{
  "query_id": "abc-123",
  "status": "success",
  "columns": [
    { "name": "ID",        "type": "NUMBER"   },
    { "name": "NOME",      "type": "VARCHAR2" },
    { "name": "VALOR",     "type": "NUMBER"   },
    { "name": "CRIADO_EM", "type": "DATE"     }
  ],
  "rows": [
    {
      "ID": 1,
      "NOME": "Pedido A",
      "VALOR": 1000.05,
      "CRIADO_EM": "15/01/2026"
    }
  ],
  "row_count": 1,
  "duration_ms": 84
}
```

### 6.3 Retorno — Erro
```json
{
  "query_id": "abc-123",
  "status": "error",
  "error": {
    "code": "ORA-00942",
    "message": "table or view does not exist"
  },
  "duration_ms": 12
}
```

### 6.4 Códigos de Erro da API
| Código | Situação |
|---|---|
| `UNAUTHORIZED` | `api_key` inválida ou ausente |
| `AGENT_OFFLINE` | Agente não está conectado |
| `AGENT_DISCONNECTED` | Agente desconectou durante a execução |
| `TIMEOUT` | Tempo limite atingido sem resposta |
| `INVALID_REQUEST` | JSON inválido ou campos obrigatórios ausentes |

---

## 7. Regras de Normalização de Dados

| Tipo Oracle | Formato no JSON |
|---|---|
| `NUMBER` sem escala | inteiro (`1000`) |
| `NUMBER` com escala | decimal com ponto (`1000.05`) |
| `DATE` | string `"dd/mm/yyyy"` |
| `TIMESTAMP` | string `"dd/mm/yyyy hh:mm:ss"` |
| `VARCHAR2` / `CHAR` / `CLOB` | string sem alteração |
| qualquer tipo nulo | `null` |

---

## 8. Keep-Alive

- Agente envia mensagem `ping` via WebSocket a cada **10 minutos**
- API responde com `pong`
- Se o agente não receber `pong` em **15 segundos**, considera a conexão morta e inicia reconexão
- Objetivo duplo: manter o Render ativo e garantir que o WebSocket está vivo

---

## 9. Timeouts

| Parâmetro | Valor |
|---|---|
| Timeout padrão de consulta | 300.000ms (5 minutos) |
| Timeout mínimo permitido | 5.000ms (5 segundos) |
| Timeout máximo permitido | 300.000ms (5 minutos) |
| Intervalo do ping keep-alive | 600.000ms (10 minutos) |
| Timeout do pong | 15.000ms (15 segundos) |

---

## 10. Modos de Execução do Agente

| Modo | Como usar | Indicado para |
|---|---|---|
| Terminal | Executar `jrti-oracle-query.exe` direto | Desenvolvimento e testes |
| Serviço Windows | `sc create` / `sc start` / `sc stop` | Produção |

Em ambos os modos o comportamento é idêntico. A diferença é apenas na inicialização, parada e visibilidade dos logs.
