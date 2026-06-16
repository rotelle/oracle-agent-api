# jrti-oracle-query — Agente Go

Agente local que conecta ao servidor Oracle 10g e encaminha consultas recebidas via WebSocket da API na nuvem.

---

## Pré-requisitos

| Requisito | Versão mínima |
|---|---|
| Go | 1.21+ |
| Oracle Instant Client | 19c (Basic ou Basic Lite) |
| Windows | 64-bit (Windows 10 ou superior) |

---

## 1. Instalar o Oracle Instant Client no Windows

1. Baixe o **Instant Client 19c Basic** para Windows x64 em:
   https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html

2. Extraia o arquivo ZIP para uma pasta fixa, por exemplo:
   ```
   C:\oracle\instantclient_19_19\
   ```

3. Adicione essa pasta ao `PATH` do sistema:
   - Painel de Controle → Sistema → Variáveis de Ambiente
   - Em **Variáveis do sistema**, edite `Path` e adicione:
     ```
     C:\oracle\instantclient_19_19
     ```

4. Reinicie o terminal e confirme:
   ```
   where oci.dll
   ```

---

## 2. Compilar o `.exe`

### No Windows (com Go instalado)

```bash
cd agent
go mod download
make build
# Gera: jrti-oracle-query.exe
```

### Em Linux/Mac (cross-compila para Windows)

```bash
# Requer mingw-w64 para CGO cross-compilation
# macOS: brew install mingw-w64
cd agent
make build
# Gera: jrti-oracle-query.exe
```

Para testar localmente em Linux:

```bash
make build-linux
# Gera: jrti-oracle-query
```

---

## 3. Configurar variáveis de ambiente Oracle no Render

As credenciais Oracle ficam **no Render** (nunca no Windows). Configure as seguintes variáveis de ambiente no painel do seu serviço web no Render:

| Variável | Descrição | Exemplo |
|---|---|---|
| `AGENT_API_KEY` | Chave de autenticação (gerar com `openssl rand -hex 32`) | `sk_a3f8c21d...` |
| `ORACLE_HOST` | IP ou hostname do servidor Oracle | `192.168.1.10` |
| `ORACLE_PORT` | Porta do listener Oracle | `1521` |
| `ORACLE_SERVICE` | Nome do serviço Oracle | `ORCL` |
| `ORACLE_USER` | Usuário do banco | `relatorios` |
| `ORACLE_PASSWORD` | Senha do banco | `senha_secreta` |

---

## 4. Executar no terminal (desenvolvimento)

```bash
jrti-oracle-query.exe --key=sk_a3f8c21d... --url=wss://sua-api.render.com
```

| Argumento | Obrigatório | Descrição |
|---|---|---|
| `--key` | ✅ | Deve ser idêntico ao `AGENT_API_KEY` configurado no Render |
| `--url` | ✅ | URL WebSocket da API (ex: `wss://sua-api.render.com`) |

O agente:
1. Conecta ao servidor via WebSocket seguro
2. Recebe credenciais Oracle criptografadas
3. Conecta ao Oracle local
4. Fica aguardando consultas

Pressione `Ctrl+C` para encerrar.

---

## 5. Instalar como serviço Windows (produção)

```bat
REM Instalar (substitua o path e os argumentos)
sc create JRTiOracleQuery ^
  binPath= "C:\jrti\jrti-oracle-query.exe --key=sk_... --url=wss://sua-api.render.com" ^
  start= auto ^
  DisplayName= "JRTi Oracle Query Agent"

REM Iniciar
sc start JRTiOracleQuery

REM Verificar status
sc query JRTiOracleQuery

REM Parar
sc stop JRTiOracleQuery

REM Remover
sc delete JRTiOracleQuery
```

O serviço inicia automaticamente com o Windows e reconecta automaticamente em caso de queda da conexão.

---

## 6. Rodar testes

```bash
cd agent
go test ./...
```

> Os testes de unidade de criptografia e normalização rodam sem Oracle.
> Os testes de integração com o banco requerem Oracle acessível.

---

## 7. Logs

O agente escreve logs estruturados no `stdout`/`stderr` com timestamp. Em modo de serviço Windows, redirecione para um arquivo:

```bat
sc create JRTiOracleQuery ^
  binPath= "C:\jrti\jrti-oracle-query.exe --key=sk_... --url=wss://... >> C:\jrti\agent.log 2>&1" ^
  start= auto
```
