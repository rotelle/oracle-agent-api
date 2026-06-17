# INSTRUCTIONS.md — Guia de Integração para a Aplicação de Relatório

> Este documento descreve como a aplicação de relatório deve construir consultas SQL compatíveis com Oracle 10g, formatar as requisições, e processar os retornos da API JRTi Oracle Query.

---

## Credenciais de Acesso

| Campo | Valor |
|---|---|
| **URL da API** | `https://oracle-agent-api-zp5a.onrender.com` |
| **api_key** | `f3ea5275-c5cf-413a-bc09-c290b0e27959` |

Use esses valores nos campos `url` e `api_key` de todas as requisições abaixo.

---

## 1. Como Fazer uma Consulta

### 1.1 Endpoint

```
POST https://sua-api.render.com/api/query
Content-Type: application/json
```

### 1.2 Estrutura da Requisição

```json
{
  "api_key": "sk_a3f8c21d7b4e4a1c9e2d",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "sql": "SELECT id, nome, valor FROM pedidos WHERE data_criacao >= :1",
  "params": ["01/01/2026"],
  "timeout_ms": 300000
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `api_key` | string | ✅ | Chave de autenticação fornecida pelo administrador |
| `query_id` | string | ✅ | Identificador único da consulta — gerar um UUID v4 a cada requisição |
| `sql` | string | ✅ | Instrução SELECT válida para Oracle 10g |
| `params` | array | ❌ | Parâmetros bind na ordem em que aparecem no SQL (`:1`, `:2`, ...) |
| `timeout_ms` | number | ❌ | Tempo máximo de espera em ms. Padrão: `300000` (5 minutos). Mín: `5000`. Máx: `300000` |

### 1.3 Regras Importantes

- Somente instruções `SELECT` são aceitas — qualquer outro comando será rejeitado
- O `query_id` deve ser único por requisição — usar UUID v4 gerado na hora da chamada
- A requisição fica suspensa até o resultado chegar — não há necessidade de polling
- O timeout padrão de 5 minutos é suficiente para a grande maioria das consultas

---

## 2. Como Processar o Retorno

### 2.1 Retorno de Sucesso

```json
{
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "columns": [
    { "name": "ID",           "type": "NUMBER"   },
    { "name": "NOME",         "type": "VARCHAR2" },
    { "name": "VALOR",        "type": "NUMBER"   },
    { "name": "DATA_CRIACAO", "type": "DATE"     }
  ],
  "rows": [
    {
      "ID": 1,
      "NOME": "Pedido A",
      "VALOR": 1000.05,
      "DATA_CRIACAO": "15/01/2026"
    },
    {
      "ID": 2,
      "NOME": "Pedido B",
      "VALOR": 250.00,
      "DATA_CRIACAO": "20/01/2026"
    }
  ],
  "row_count": 2,
  "duration_ms": 84
}
```

### 2.2 Tipos de Dados no Retorno

| Tipo Oracle | Tipo no JSON | Exemplo |
|---|---|---|
| `NUMBER` sem casas decimais | `number` inteiro | `42` |
| `NUMBER` com casas decimais | `number` decimal | `1000.05` |
| `DATE` | `string` no formato `dd/mm/yyyy` | `"15/01/2026"` |
| `TIMESTAMP` | `string` no formato `dd/mm/yyyy hh:mm:ss` | `"15/01/2026 14:32:00"` |
| `VARCHAR2` / `CHAR` / `CLOB` | `string` | `"Pedido A"` |
| qualquer campo nulo | `null` | `null` |

### 2.3 Atenção ao Processar Datas

As datas chegam no formato brasileiro `dd/mm/yyyy`. Ao interpretar ou comparar datas, considerar sempre esse formato:
- `"01/02/2026"` significa **1º de fevereiro** de 2026, não 2 de janeiro
- Para ordenar datas recebidas, converter para o formato `yyyy-mm-dd` internamente antes de comparar

### 2.4 Atenção aos Números

- O separador decimal é **ponto** (`.`): `1000.05`
- Não há separador de milhar nos números retornados
- Inteiros chegam sem casas decimais: `42`, não `42.0`

### 2.5 Retorno de Erro

```json
{
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "error",
  "error": {
    "code": "ORA-00942",
    "message": "table or view does not exist"
  },
  "duration_ms": 12
}
```

### 2.6 Tabela de Códigos de Erro

| Código | Origem | Significado | O que fazer |
|---|---|---|---|
| `UNAUTHORIZED` | API | `api_key` inválida ou ausente | Verificar a chave configurada |
| `INVALID_REQUEST` | API | JSON malformado ou campos obrigatórios ausentes | Corrigir a requisição |
| `AGENT_OFFLINE` | API | Agente Go não está conectado ao servidor Windows | Aguardar e tentar novamente |
| `AGENT_DISCONNECTED` | API | Agente desconectou durante a execução | Reenviar a consulta |
| `TIMEOUT` | API | Tempo limite atingido sem resposta | Simplificar a consulta ou aumentar `timeout_ms` |
| `ORA-XXXXX` | Oracle | Erro do próprio banco de dados | Ver seção de erros Oracle comuns abaixo |

---

## 3. Limitações do Oracle 10g — Regras de Escrita de SQL

Esta é a seção mais importante. O Oracle 10g tem diferenças significativas em relação a bancos modernos. As regras abaixo devem ser seguidas rigorosamente.

---

### 3.1 Paginação — NUNCA usar LIMIT/OFFSET

O Oracle 10g **não suporta** `LIMIT` nem `OFFSET`. Usar sempre `ROWNUM`.

❌ **Errado (sintaxe MySQL/PostgreSQL):**
```sql
SELECT id, nome FROM pedidos LIMIT 10 OFFSET 20
```

✅ **Correto — primeiras N linhas:**
```sql
SELECT id, nome FROM pedidos WHERE ROWNUM <= 10
```

✅ **Correto — paginação com ROWNUM (página 3, 10 por página):**
```sql
SELECT * FROM (
  SELECT t.*, ROWNUM AS rn FROM (
    SELECT id, nome FROM pedidos ORDER BY id
  ) t WHERE ROWNUM <= 30
) WHERE rn > 20
```

> **Regra:** `ROWNUM` é atribuído **antes** do `ORDER BY`. Por isso sempre envolver em subquery quando usar `ORDER BY` com paginação.

---

### 3.2 TOP N — Não existe no Oracle

❌ **Errado (sintaxe SQL Server):**
```sql
SELECT TOP 10 id, nome FROM pedidos
```

✅ **Correto:**
```sql
SELECT id, nome FROM pedidos WHERE ROWNUM <= 10
```

---

### 3.3 Datas — Usar TO_DATE e o formato correto

O Oracle 10g é rigoroso com datas. Nunca passar strings de data sem `TO_DATE`.

❌ **Errado:**
```sql
SELECT * FROM pedidos WHERE data_criacao >= '2026-01-01'
SELECT * FROM pedidos WHERE data_criacao >= '01/01/2026'
```

✅ **Correto com TO_DATE:**
```sql
SELECT * FROM pedidos WHERE data_criacao >= TO_DATE('01/01/2026', 'DD/MM/YYYY')
```

✅ **Correto com parâmetro bind (preferível):**
```json
{
  "sql": "SELECT * FROM pedidos WHERE data_criacao >= TO_DATE(:1, 'DD/MM/YYYY')",
  "params": ["01/01/2026"]
}
```

**Funções de data disponíveis no Oracle 10g:**
| Função | Descrição | Exemplo |
|---|---|---|
| `SYSDATE` | Data e hora atual do servidor | `WHERE data <= SYSDATE` |
| `TRUNC(data)` | Remove a hora de uma data | `TRUNC(SYSDATE)` = hoje sem hora |
| `TO_DATE(str, fmt)` | Converte string para data | `TO_DATE('01/01/2026', 'DD/MM/YYYY')` |
| `TO_CHAR(data, fmt)` | Converte data para string | `TO_CHAR(data_criacao, 'DD/MM/YYYY')` |
| `ADD_MONTHS(data, n)` | Adiciona meses a uma data | `ADD_MONTHS(SYSDATE, -3)` |
| `MONTHS_BETWEEN(d1, d2)` | Meses entre duas datas | `MONTHS_BETWEEN(SYSDATE, data_criacao)` |
| `LAST_DAY(data)` | Último dia do mês | `LAST_DAY(SYSDATE)` |

**Aritmética de datas (Oracle usa dias como unidade):**
```sql
-- Últimos 30 dias
SELECT * FROM pedidos WHERE data_criacao >= SYSDATE - 30

-- Últimas 2 horas
SELECT * FROM pedidos WHERE data_criacao >= SYSDATE - 2/24

-- Últimos 30 minutos
SELECT * FROM pedidos WHERE data_criacao >= SYSDATE - 30/1440
```

---

### 3.4 Concatenação de Strings — Usar ||

❌ **Errado (sintaxe SQL Server/MySQL):**
```sql
SELECT CONCAT(nome, ' ', sobrenome) FROM clientes
-- CONCAT com mais de 2 argumentos não existe no Oracle 10g
```

✅ **Correto:**
```sql
SELECT nome || ' ' || sobrenome AS nome_completo FROM clientes
```

> O Oracle 10g suporta `CONCAT` apenas com **2 argumentos**. Para mais, usar `||`.

---

### 3.5 Valores Nulos — Usar NVL

❌ **Errado (sintaxe SQL Server):**
```sql
SELECT ISNULL(valor, 0) FROM pedidos
SELECT IFNULL(valor, 0) FROM pedidos
```

✅ **Correto:**
```sql
SELECT NVL(valor, 0) FROM pedidos
SELECT NVL(descricao, 'Sem descrição') FROM pedidos
```

**Funções de nulo disponíveis:**
| Função | Descrição |
|---|---|
| `NVL(expr, alternativa)` | Retorna alternativa se expr for nulo |
| `NVL2(expr, se_nao_nulo, se_nulo)` | Retorna valor diferente dependendo se é nulo |
| `NULLIF(expr1, expr2)` | Retorna nulo se as expressões forem iguais |
| `COALESCE(e1, e2, ...)` | Retorna o primeiro não nulo (disponível no 10g) |

---

### 3.6 CASE WHEN — Suportado no Oracle 10g

O `CASE WHEN` é suportado normalmente:

```sql
SELECT
  id,
  nome,
  CASE
    WHEN valor > 1000 THEN 'Alto'
    WHEN valor > 500  THEN 'Médio'
    ELSE 'Baixo'
  END AS faixa_valor
FROM pedidos
```

O `DECODE` também funciona (sintaxe legada Oracle):
```sql
SELECT DECODE(status, 'A', 'Ativo', 'I', 'Inativo', 'Desconhecido') FROM clientes
```

---

### 3.7 Subconsultas e CTEs

**CTE (WITH) é suportada no Oracle 10g**, mas sem recursividade:

✅ **Correto:**
```sql
WITH totais AS (
  SELECT cliente_id, SUM(valor) AS total
  FROM pedidos
  GROUP BY cliente_id
)
SELECT c.nome, t.total
FROM clientes c
JOIN totais t ON c.id = t.cliente_id
```

❌ **Não suportado — CTE recursiva:**
```sql
WITH RECURSIVE hierarquia AS (...)  -- não existe no Oracle 10g
```

> Para hierarquias, usar `CONNECT BY` (ver seção 3.11).

---

### 3.8 JOINs — Preferir sintaxe ANSI

O Oracle 10g suporta tanto a sintaxe ANSI quanto a sintaxe legada com `(+)`. Usar sempre a sintaxe ANSI por clareza:

✅ **Correto (ANSI):**
```sql
SELECT p.id, p.valor, c.nome
FROM pedidos p
INNER JOIN clientes c ON p.cliente_id = c.id
LEFT JOIN itens i ON i.pedido_id = p.id
```

❌ **Evitar (sintaxe legada Oracle):**
```sql
SELECT p.id, p.valor, c.nome
FROM pedidos p, clientes c
WHERE p.cliente_id = c.id (+)
```

---

### 3.9 Funções de Agregação Disponíveis

| Função | Disponível no 10g |
|---|---|
| `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` | ✅ |
| `STDDEV`, `VARIANCE` | ✅ |
| `GROUP BY ROLLUP(...)` | ✅ |
| `GROUP BY CUBE(...)` | ✅ |
| `GROUPING SETS` | ✅ |
| `LISTAGG` | ❌ (disponível apenas no 11g) |
| `PIVOT` / `UNPIVOT` | ❌ (disponível apenas no 11g) |

**Alternativa para LISTAGG no Oracle 10g:**
```sql
-- Concatenar valores de um grupo em uma string
SELECT
  cliente_id,
  RTRIM(XMLAGG(XMLELEMENT(e, produto || ',')).EXTRACT('//text()'), ',') AS produtos
FROM pedidos
GROUP BY cliente_id
```

---

### 3.10 Funções Analíticas (Window Functions)

O Oracle 10g **suporta** funções analíticas com `OVER()`:

```sql
SELECT
  id,
  nome,
  valor,
  ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY data_criacao DESC) AS rn,
  SUM(valor) OVER (PARTITION BY cliente_id) AS total_cliente,
  RANK() OVER (ORDER BY valor DESC) AS ranking
FROM pedidos
```

> Funções disponíveis: `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`, `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `SUM`, `AVG`, `COUNT`, `MIN`, `MAX` com `OVER()`.

---

### 3.11 Hierarquias — Usar CONNECT BY

Para dados hierárquicos (categorias em árvore, organogramas, etc.):

```sql
SELECT
  id,
  nome,
  pai_id,
  LEVEL AS nivel,
  SYS_CONNECT_BY_PATH(nome, ' > ') AS caminho
FROM categorias
START WITH pai_id IS NULL
CONNECT BY PRIOR id = pai_id
ORDER SIBLINGS BY nome
```

---

### 3.12 Tipo de Dados DUAL

Para consultas que não precisam de tabela:

```sql
-- Data atual
SELECT SYSDATE FROM DUAL

-- Cálculo simples
SELECT 2 + 2 AS resultado FROM DUAL

-- Converter valor
SELECT TO_CHAR(SYSDATE, 'DD/MM/YYYY') AS hoje FROM DUAL
```

---

### 3.13 Diferença entre VARCHAR2 e CHAR

- `VARCHAR2`: tamanho variável — comparações normais
- `CHAR`: tamanho fixo — preenchido com espaços à direita

```sql
-- Se status for CHAR(1), comparar normalmente
SELECT * FROM pedidos WHERE status = 'A'

-- Se houver problemas com CHAR, usar TRIM
SELECT * FROM pedidos WHERE TRIM(status) = 'A'
```

---

### 3.14 ROWID — Não usar como identificador

O `ROWID` é interno do Oracle e pode mudar. Nunca usar `ROWID` como identificador de registros no retorno.

---

### 3.15 Sensibilidade a Maiúsculas/Minúsculas

O Oracle **não é** case-sensitive para nomes de objetos (tabelas, colunas), mas **é** case-sensitive para valores de string:

```sql
-- Estas duas consultas são equivalentes
SELECT ID, NOME FROM PEDIDOS
SELECT id, nome FROM pedidos

-- Mas estas NÃO são equivalentes
SELECT * FROM clientes WHERE nome = 'João'   -- retorna registros com 'João'
SELECT * FROM clientes WHERE nome = 'JOÃO'   -- retorna registros com 'JOÃO'

-- Para busca case-insensitive
SELECT * FROM clientes WHERE UPPER(nome) = UPPER('joão')
```

---

## 4. Uso de Parâmetros Bind

Sempre que possível, usar parâmetros bind em vez de concatenar valores no SQL. Isso evita SQL injection e melhora a performance (Oracle reusa o plano de execução).

### 4.1 Sintaxe

Os parâmetros são identificados por `:1`, `:2`, `:3`... na ordem em que aparecem no SQL, e fornecidos no array `params` na mesma ordem.

```json
{
  "sql": "SELECT * FROM pedidos WHERE cliente_id = :1 AND status = :2 AND data_criacao >= TO_DATE(:3, 'DD/MM/YYYY')",
  "params": [42, "A", "01/01/2026"]
}
```

### 4.2 Tipos de Parâmetros

| Tipo de valor | Como enviar no JSON |
|---|---|
| Número inteiro | `42` |
| Número decimal | `1000.05` |
| String | `"texto"` |
| Data (para campos DATE) | `"dd/mm/yyyy"` com TO_DATE no SQL |
| Nulo | `null` |

### 4.3 Parâmetros em Cláusula IN

O Oracle não aceita array em parâmetro bind para `IN`. Para `IN` com valores dinâmicos, usar subconsulta ou montar a lista no SQL:

❌ **Não funciona:**
```json
{
  "sql": "SELECT * FROM pedidos WHERE id IN (:1)",
  "params": [[1, 2, 3]]
}
```

✅ **Correto — para poucos valores conhecidos:**
```json
{
  "sql": "SELECT * FROM pedidos WHERE id IN (:1, :2, :3)",
  "params": [1, 2, 3]
}
```

---

## 5. Erros Oracle Comuns e Como Resolver

| Código | Mensagem | Causa | Solução |
|---|---|---|---|
| `ORA-00904` | invalid identifier | Nome de coluna inexistente ou com erro de digitação | Verificar nome exato da coluna |
| `ORA-00907` | missing right parenthesis | Erro de sintaxe SQL | Verificar parênteses e sintaxe |
| `ORA-00911` | invalid character | Caractere inválido no SQL (ex: ponto-e-vírgula no final) | Remover `;` do final do SQL |
| `ORA-00923` | FROM keyword not found | Erro de sintaxe antes do FROM | Verificar o SELECT |
| `ORA-00933` | SQL command not properly ended | SQL com comando não suportado ou mal formado | Verificar sintaxe |
| `ORA-00936` | missing expression | Expressão incompleta | Verificar colunas e expressões |
| `ORA-00942` | table or view does not exist | Tabela não encontrada | Verificar nome da tabela e schema |
| `ORA-01000` | maximum open cursors exceeded | Muitas consultas simultâneas abertas | Reduzir consultas simultâneas |
| `ORA-01017` | invalid username/password | Credenciais Oracle inválidas | Verificar configuração no Render |
| `ORA-01722` | invalid number | Tentativa de converter string não numérica | Verificar valores e tipos |
| `ORA-01830` | date format picture ends before converting | Formato de data incorreto | Verificar máscara no TO_DATE |
| `ORA-01843` | not a valid month | Mês inválido na data | Verificar valor da data |
| `ORA-12154` | TNS: could not resolve connect identifier | Problema de conexão com o Oracle | Verificar configuração de host/serviço |

> **Regra geral:** nunca incluir `;` (ponto-e-vírgula) no final do SQL — o Oracle rejeita com `ORA-00933`.

---

## 6. Boas Práticas para a Aplicação de Relatório

### 6.1 Sempre limitar o resultado
Consultas sem limite podem retornar milhares de linhas e estourar o timeout. Usar `ROWNUM` quando o volume for incerto:

```sql
SELECT id, nome, valor FROM pedidos
WHERE data_criacao >= TO_DATE(:1, 'DD/MM/YYYY')
AND ROWNUM <= 1000
```

### 6.2 Gerar query_id único por requisição
Nunca reutilizar um `query_id`. Gerar um UUID v4 novo para cada chamada.

### 6.3 Verificar status antes de processar rows
```
retorno.status === "success" → processar retorno.rows
retorno.status === "error"   → tratar retorno.error.code e retorno.error.message
```

### 6.4 Tratar null nos campos
Qualquer campo pode ser `null`. Verificar antes de usar o valor em cálculos ou formatações.

### 6.5 Reenviar em caso de AGENT_DISCONNECTED
Se o erro for `AGENT_DISCONNECTED`, a consulta não chegou a ser executada no Oracle. É seguro reenviar a mesma consulta com um novo `query_id`.

### 6.6 Não reenviar em caso de TIMEOUT
Se o erro for `TIMEOUT`, a consulta **pode ter sido executada** no Oracle e apenas o retorno não voltou a tempo. Reenviar pode causar leitura duplicada dependendo do contexto. Avaliar antes de reenviar.

### 6.7 Ordenação explícita
O Oracle não garante ordem de retorno sem `ORDER BY`. Sempre incluir `ORDER BY` quando a ordem importar para o relatório.

---

## 7. Exemplo Completo

### Requisição
```json
{
  "api_key": "sk_a3f8c21d7b4e4a1c9e2d",
  "query_id": "7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "sql": "SELECT p.id, p.numero, c.nome AS cliente, p.valor_total, p.data_criacao FROM pedidos p INNER JOIN clientes c ON c.id = p.cliente_id WHERE p.data_criacao >= TO_DATE(:1, 'DD/MM/YYYY') AND p.status = :2 AND ROWNUM <= :3 ORDER BY p.data_criacao DESC",
  "params": ["01/01/2026", "A", 100],
  "timeout_ms": 30000
}
```

### Retorno
```json
{
  "query_id": "7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "status": "success",
  "columns": [
    { "name": "ID",           "type": "NUMBER"   },
    { "name": "NUMERO",       "type": "VARCHAR2" },
    { "name": "CLIENTE",      "type": "VARCHAR2" },
    { "name": "VALOR_TOTAL",  "type": "NUMBER"   },
    { "name": "DATA_CRIACAO", "type": "DATE"     }
  ],
  "rows": [
    {
      "ID": 1042,
      "NUMERO": "PED-2026-1042",
      "CLIENTE": "Empresa ABC Ltda",
      "VALOR_TOTAL": 5750.90,
      "DATA_CRIACAO": "15/06/2026"
    },
    {
      "ID": 1041,
      "NUMERO": "PED-2026-1041",
      "CLIENTE": "Comércio XYZ",
      "VALOR_TOTAL": 320.00,
      "DATA_CRIACAO": "14/06/2026"
    }
  ],
  "row_count": 2,
  "duration_ms": 143
}
```
