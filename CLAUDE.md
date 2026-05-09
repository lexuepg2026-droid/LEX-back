# CLAUDE.md — LEX Backend

> Contexto técnico fixo para sessões com Claude Code.
> Leia este arquivo antes de qualquer análise ou edição.

---

## Nome do projeto

**LEX — Sistema de Gerenciamento de Advocacia**

---

## Objetivo

Sistema multi-tenant para gerenciamento de clientes, processos, documentos,
honorários, parcelas e pagamentos de um escritório de advocacia.
Cada advogado (usuário autenticado) gerencia exclusivamente os seus próprios dados.

---

## Stack

| Camada      | Tecnologia                        |
|-------------|-----------------------------------|
| Runtime     | Node.js (ESM — `"type": "module"`) |
| Framework   | Express 5                         |
| Banco       | MongoDB Atlas via Mongoose 9      |
| Auth        | JWT (jsonwebtoken) + bcryptjs     |
| Config      | dotenv                            |
| Dev         | nodemon                           |

Variáveis de ambiente: `PORT`, `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`
— definidas em `.env` (nunca versionado).

---

## Arquitetura

```
src/
  app.js               Express app (middlewares + rotas)
  server.js            Entry point (conecta ao banco e sobe o servidor)
  config/
    db.js              Conexão com o MongoDB
  routes/              Define endpoints e aplica authMiddleware
  controllers/         Recebem req/res/next, chamam o service, respondem HTTP
  services/            Lógica de negócio, queries no banco, lançam erros com statusCode
  models/              Schemas Mongoose
  validations/         Funções puras que retornam arrays/objetos de erros
  middleware/
    authMiddleware.js  Verifica JWT e popula req.user
    errorMiddleware.js Handler global de erros (4 parâmetros)
    notFoundMiddleware.js  Responde 404 para rotas inexistentes
```

Fluxo: `routes → controllers → services → models`

---

## Convenções de nomenclatura

- Arquivos, pastas e funções: **inglês**
- Campos do banco de dados: **português**
  - Exemplos: `usuarioId`, `clienteId`, `processoId`, `valorPago`, `dataVencimento`, `numeroParcela`

---

## Regras centrais de negócio

1. **Isolamento por usuário:** toda entidade possui `usuarioId`. Toda busca, listagem, atualização e exclusão deve incluir `{ usuarioId }` no filtro. Nunca omitir.
2. **Hierarquia de dados:**
   - Processos → pertencem a Clientes
   - Documentos → pertencem a Processos
   - Honorários (Fees) → pertencem a Processos
   - Parcelas (Installments) → pertencem a Honorários
   - Pagamentos (Payments) → pertencem a Parcelas
3. **Ao criar um recurso filho**, o service deve verificar que o pai existe e pertence ao mesmo `usuarioId`.
4. **Soft delete universal:** exclusões definem `ativo: false` em vez de remover o documento. Todas as queries de leitura filtram `ativo: true`.
5. **Paginação obrigatória:** todos os endpoints `GET /` aceitam `?page=1&limit=20` e retornam `{ data, total, page, limit, totalPages }`. Limite máximo: 100.
6. **Padrão de erros:** services lançam `const err = new Error(msg); err.statusCode = 4xx; throw err`. O `errorHandler` captura e responde `{ message, errors? }`. Controllers nunca respondem erros diretamente — sempre `return next(error)`.

---

## Módulos existentes

| Módulo       | Routes | Controller | Service | Model | Validation |
|--------------|--------|------------|---------|-------|------------|
| Auth         | ✅     | ✅         | ✅      | ✅    | ✅         |
| Clients      | ✅     | ✅         | ✅      | ✅    | ✅         |
| Processes    | ✅     | ✅         | ✅      | ✅    | ✅         |
| Documents    | ✅     | ✅         | ✅      | ✅    | ✅         |
| Fees         | ✅     | ✅         | ✅      | ✅    | ✅         |
| Installments | ✅     | ✅         | ✅      | ✅    | ✅         |
| Payments     | ✅     | ✅         | ✅      | ✅    | ✅         |

Todos os controllers e services usam **funções exportadas** — sem classes.

---

## Regras de qualidade para esta sessão

- Controllers devem ser simples: receber request, chamar service, responder.
- Services concentram toda a lógica de negócio e validação.
- Evitar validação duplicada entre controller e service.
- Antes de alterar algo, analisar impacto nos módulos relacionados.
- Antes de editar mais de 3 arquivos, apresentar o plano e aguardar confirmação.
- Não remover regras de isolamento (`usuarioId`).
- Não alterar `.env`.
- Não expor secrets, senhas, tokens, strings de conexão ou IPs sensíveis.
- Nunca executar `git push` sem confirmação explícita.
- Sempre que for fazer mais de 3 alterações de arquivos, criar um commit antes para ter ponto de restauração.

---

## Fluxo de trabalho esperado

1. **Analisar** os arquivos relevantes.
2. **Explicar** o plano e o impacto.
3. **Aguardar confirmação** antes de editar.
4. **Editar** os arquivos.
5. **Mostrar** o diff/resumo do que mudou.
6. **Sugerir** testes no Postman ou terminal.

---

## Estado atual do projeto

- Todos os 7 módulos implementados e funcionais.
- Soft delete alinhado em todos os módulos (`ativo: false`).
- Paginação implementada em todas as listagens.
- Middleware global de erros registrado (`errorMiddleware` + `notFoundMiddleware`).
- CORS configurado via `CORS_ORIGIN` no `.env`.
- Todos os controllers usam `next(error)` — nenhum responde erros diretamente.
- Repositório: https://github.com/danisprodrigues22-maker/LEX (branch `main`)

---

## Cuidados pendentes

- [x] ~~**Validação duplicada no `clientController`**~~ — resolvido em 2026-05-09. Validação e tratamento de chave duplicada movidos para o `clientService`.
- [x] ~~**Credenciais expostas**~~ — resolvido em 2026-05-09. Senha do MongoDB Atlas e `JWT_SECRET` rotacionados manualmente. `.env` não está rastreado pelo Git e nunca esteve no histórico do repositório atual. Nenhum secret encontrado hardcoded nos arquivos versionados.
- [ ] Confirmar que todos os relacionamentos validam `usuarioId` ao verificar entidade pai antes de criar filho.
- [ ] Confirmar que nenhum endpoint lista dados sem filtrar `ativo: true`.

---

## Comandos para rodar

```bash
# Backend
cd ~/Daniel/Trabalhos\ uepg/lexa/lex-backend
npm run dev          # nodemon src/server.js — porta 3001
```

---

## Rotina de encerramento de sessão

Antes de fechar qualquer sessão, peça:

> "Atualize o CLAUDE.md com o que foi feito hoje, os arquivos alterados, decisões tomadas, pendências e próximo passo recomendado."

---

## Modelo de registro de sessão

### Sessão — AAAA-MM-DD

**Resumo:**

**Arquivos criados:**

**Arquivos alterados:**

**Decisões tomadas:**

**Problemas encontrados:**

**Pendências:**

**Commit realizado:**

**Alterações ainda não commitadas:**

**Próximo passo recomendado:**

---

## Registro de sessões

### Sessão — 2026-05-06

**Resumo:** Sessão de refatoração e padronização completa do backend.

**Arquivos criados:**
- `src/middleware/errorMiddleware.js`
- `src/middleware/notFoundMiddleware.js`

**Arquivos alterados:**
- `src/app.js` — registro de middlewares de erro e CORS
- `src/controllers/` — todos os controllers refatorados para `next(error)` e funções
- `src/services/paymentService.js` — convertido de classe para funções
- `src/services/clientService.js`, `processService.js`, `documentService.js`, `feeService.js`, `installmentService.js` — soft delete alinhado; `ativo: true` adicionado em todas as queries
- `src/models/Fee.js` — enums adicionados em `tipo` e `status`
- `src/validations/feeValidation.js` — validação dos enums
- Todos os services de listagem — paginação implementada

**Decisões tomadas:**
- Soft delete universal via `ativo: false` em todos os módulos
- Paginação obrigatória em todos os GET /
- Controllers delegam 100% ao service (exceto `clientController` — pendente)
- Dois repositórios GitHub separados: backend e frontend

**Problemas encontrados:**
- `clientController` ainda tem validação duplicada (pendente)
- Credenciais foram commitadas em histórico anterior (pendente — ação manual)

**Commits realizados:**
```
410657b  Alinha estratégia de delete para soft delete em todos os módulos
c5964ee  Converte paymentService de classe para funções
44769f1  Adiciona paginação em todas as listagens do backend
d7d035e  Adiciona enum em Fee.tipo e Fee.status
5d4eecc  Configura CORS com origin explícito via variável de ambiente
c0752ff  Reestrutura projeto em src/ e implementa middleware global de erros
```

**Alterações ainda não commitadas:** nenhuma.

**Próximo passo recomendado:** remover validação duplicada do `clientController` e delegar inteiramente ao `clientService`.

---

### Sessão — 2026-05-09

**Resumo:** Configuração da operação com Claude Code, resolução das duas pendências técnicas restantes e rotação de credenciais.

**Arquivos criados:**
- `CLAUDE.md` (raiz do lex-backend) — contexto técnico para o Claude Code
- `03 - Projetos/LEX/LEX - Decisões.md` (Obsidian) — registro de decisões técnicas
- `03 - Projetos/LEX/LEX - Próxima sessão.md` (Obsidian) — planejamento de próximas sessões

**Arquivos alterados:**
- `src/controllers/clientController.js` — removida validação duplicada; controller agora é thin wrapper
- `src/services/clientService.js` — validação e tratamento de chave duplicada (11000) movidos para o service
- `07 - Prompts e Contexto/LEX - Prompts e Contexto.md` (Obsidian) — 10 prompts operacionais adicionados

**Decisões tomadas:**
- Validação sempre no service, nunca no controller — padrão unificado em todos os módulos
- `CLAUDE.md` versionado junto com o código para contexto persistente

**Problemas encontrados:**
- Nenhum

**Pendências:**
- Nenhuma pendência crítica restante. Itens opcionais: confirmar validação de `usuarioId` em todos os relacionamentos pai-filho; confirmar filtro `ativo: true` em todos os endpoints.

**Commits realizados:**
```
3bedaf9  Adiciona CLAUDE.md com contexto técnico do projeto para o Claude Code
855aff4  Remove validação duplicada do clientController
```

**Alterações ainda não commitadas:** nenhuma.

**Próximo passo recomendado:** planejamento de novas funcionalidades (dashboard com métricas, filtros nas listagens, testes automatizados).

---

### Sessão — 2026-05-09 (segunda parte)

**Resumo:** Estabilização profissional do frontend — correção de todos os módulos para compatibilidade com o backend atual. Fluxo por módulo: análise → plano → confirmação → edição → build → commit.

**Arquivos alterados no backend:**
- `src/services/processService.js` — `.populate("clienteId", ...)` em `listProcesses` e `getProcessById`
- `src/services/feeService.js` — `.populate("processoId", ...)` em `listFees` e `getFeeById`

**Arquivos alterados no frontend (por módulo):**
- Clientes: `clientService.js`, `ClientListPage.jsx`, `ClientFormPage.jsx`, `ClientDetailPage.jsx`, `AppRoutes.jsx`
- Processos: `processService.js`, `ProcessListPage.jsx`, `ProcessFormPage.jsx`, `ProcessDetailPage.jsx`, `ProcessTabs.jsx`
- Honorários: `feeService.js`, `FeeListPage.jsx`, `FeeFormPage.jsx`
- Parcelas: `installmentService.js`, `InstallmentListPage.jsx`, `InstallmentFormPage.jsx`

**Decisões tomadas:**
- Frontend lê `response.data.data ?? response.data` em todas as listagens (respostas paginadas)
- `dataPagamento` só é enviada no payload quando `status === "pago"` (regra de negócio de Parcelas)
- Payloads explícitos — sem spread de `formData` — para evitar campos inesperados no backend
- Populates mínimos no backend apenas onde necessário para exibição (nomes, não campos extras)

**Commits realizados:**
```
4f6a439  backend: Adiciona populate de clienteId em listProcesses e getProcessById
642f558  backend: Adiciona populate de processoId em listFees e getFeeById
57ef774  frontend: Corrige módulo de Clientes para funcionar com o backend atual
5daa4bd  frontend: Corrige módulo de Processos para funcionar com o backend atual
69e389e  frontend: Corrige módulo de Honorários para funcionar com o backend atual
4d5bf98  frontend: Corrige módulo de Parcelas para funcionar com o backend atual
```

**Situação dos commits locais (sem push ainda):**
- Backend: 2 commits à frente de origin/main
- Frontend: 4 commits à frente de origin/main

**Alterações ainda não commitadas:** `CLAUDE.md` (esta atualização) — commitar ao encerrar.

**Próximo passo recomendado:** analisar módulo de Pagamentos no frontend (mesmo fluxo). Depois: Documentos. Dashboard somente após todos os módulos principais estabilizados.
