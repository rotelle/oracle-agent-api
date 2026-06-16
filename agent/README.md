# jrti-oracle-query — Agente Go

Agente local que conecta ao servidor Oracle 10g e encaminha consultas recebidas via WebSocket da API na nuvem.

---

## Pré-requisitos de compilação (apenas na máquina que compila)

| Requisito | Versão mínima | Observação |
|---|---|---|
| Go | 1.21+ | [go.dev/dl](https://go.dev/dl/) |
| MinGW-w64 (GCC) | qualquer | `choco install mingw` ou [mingw-w64.org](https://www.mingw-w64.org/) |
| Oracle Instant Client zip | 19c Basic, Windows x64 | Colocar o `.zip` na pasta `agent/` |

> A máquina de destino que vai **rodar** o agente não precisa de nada instalado — tudo está em `dist/`.

---

## 1. Compilar e montar o pacote portável

```bash
cd agent

# Extraia o Instant Client zip na pasta agent/ (resulta em instantclient_19_30/)
go mod download
make dist
# Gera: dist/jrti-oracle-query.exe  +  dist/*.dll  (~217 MB)
```

Copie a pasta `dist/` completa para qualquer máquina Windows — os DLLs Oracle ficam **junto ao `.exe`** e o Windows os encontra automaticamente (DLL search order inclui o diretório do executável).

### Compilar só o `.exe` (sem montar o dist/)

```bash
make build        # Windows nativo com GCC no PATH
make build-cross  # cross-compilação de Linux/Mac com mingw-w64
make build-linux  # binário Linux para testes locais
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

Execute a partir da pasta `dist/`:

```bat
cd dist
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
REM O .exe deve ser executado de dentro da pasta dist/ para encontrar os DLLs Oracle
sc create JRTiOracleQuery ^
  binPath= "C:\jrti\dist\jrti-oracle-query.exe --key=sk_... --url=wss://sua-api.render.com" ^
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
