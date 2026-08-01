# CLAUDE.md — LEX Backend

> Contexto técnico fixo para sessões com Claude Code.
> Leia este arquivo antes de qualquer análise ou edição.
>
> **Artefato de trabalho, não documentação da banca.** A entrega acadêmica
> (anteprojeto, monografia, apresentação) vive fora do repositório e não se
> mistura com este arquivo.

---

## Nome do projeto

**LEX — Sistema de Gerenciamento de Advocacia**

TCC de Engenharia de Software na UEPG, feito para uma advogada autônoma real.
O sistema é de **uma** advogada: quando o texto tem gênero, é o feminino.

---

## Objetivo

PWA multi-tenant para gestão de clientes, processos, documentos, honorários,
parcelas e pagamentos de um escritório de advocacia. Cada usuária autenticada
gerencia exclusivamente os seus próprios dados.

---

## Stack

| Camada      | Tecnologia                          |
|-------------|-------------------------------------|
| Runtime     | Node.js (ESM — `"type": "module"`)  |
| Framework   | Express 5                           |
| Banco       | MongoDB Atlas via Mongoose 9        |
| Auth        | JWT (jsonwebtoken) + bcryptjs, cookie httpOnly `lex-token` |
| Rate limit  | express-rate-limit                  |
| PDF         | pdfmake `0.3.11`                    |
| DOCX        | docx                                |
| Config      | dotenv                              |
| Dev         | nodemon                             |

Variáveis de ambiente: `PORT`, `MONGO_URI`, `JWT_SECRET`,
**`JWT_PORTAL_SECRET`**, `CORS_ORIGIN`, `RATE_LIMIT_JANELA_MINUTOS` e os tetos
por operação (inclusive `RATE_LIMIT_PORTAL_LOGIN`) — definidas em `.env` (nunca
versionado). Ver `.env.example`.

**`JWT_PORTAL_SECRET` é obrigatório e precisa ser diferente do `JWT_SECRET`.**
`src/app.js` chama `assertSegredoDoPortal()` na carga e **derruba o processo**
se faltar ou se forem iguais. Ver DEC-029 mais abaixo.

**`pdfmake` fica na linha 0.3.x.** A 0.4 mudou a API de fontes e não traz nada
que esta fase precise. Não subir sem motivo escrito.

---

## Arquitetura

```
src/
  app.js               Express app (middlewares + rotas)
  server.js            Entry point (conecta ao banco e sobe o servidor)
  config/
    db.js                    Conexão com o MongoDB
    templateVariables.js     Catálogo FECHADO de variáveis (48 chaves)
    variableLabels.js        Rótulos e descrições do catálogo + guarda
  routes/              Define endpoints e aplica authMiddleware
  controllers/         Recebem req/res/next, chamam o service, respondem HTTP
  services/            Lógica de negócio, queries, lançam erros com statusCode
  models/              Schemas Mongoose
    shared/enderecoSchema.js Endereço reaproveitado por User e Client
  validations/         Funções puras que retornam arrays/objetos de erros
  utils/               Parser de template, formatadores, lacunas, extenso, texto
  middleware/
    authMiddleware.js        Verifica JWT e popula req.user
    errorMiddleware.js       Handler global de erros (4 parâmetros)
    notFoundMiddleware.js    Responde 404 para rotas inexistentes
scripts/
  resetDev.js          Derruba as coleções (só fora de produção)
  seedDemo.js          Popula a base de demonstração
```

Fluxo: `routes → controllers → services → models`

---

## Convenções de nomenclatura

- Arquivos, pastas e funções: **inglês**
- Campos do banco de dados: **português**
  — `usuarioId`, `clienteId`, `processoId`, `valorPago`, `dataVencimento`
- Rotas: **inglês** (`/api/documents`), com exceção dos sub-recursos que
  nomeiam conceito do domínio já em português (`/secoes`, `/clientes`,
  `/visibilidade-portal`, `/reordenar`, `/texto`, `/gerar`, `/variaveis`)
- **`PATCH` é o verbo de update.** `PUT` existe só como alias depreciado em
  `/clients`, `/processes` e `/documents`, por compatibilidade. Recurso novo
  não ganha alias.
- Validação **escrita à mão**, no padrão de `clientValidation.js`.
  **Sem zod, joi ou yup** — nenhuma dependência de validação.
- Campo apagado grava **`null`**, nunca `undefined`.

---

## Regras centrais de negócio

1. **Isolamento por usuário:** toda entidade tem `usuarioId`. Toda busca,
   listagem, atualização e exclusão inclui `{ usuarioId }` no filtro. Nunca
   omitir.
2. **Soft delete universal:** exclusão define `ativo: false`. Toda leitura
   filtra `ativo: true`. Toda coleção tem `usuarioId` e `ativo`.
3. **Ao criar recurso filho**, o service verifica que o pai existe e pertence
   ao mesmo `usuarioId`.
4. **Paginação obrigatória** em todo `GET /`: `?page=1&limit=20`, resposta
   `{ data, total, page, limit, totalPages }`. Limite máximo 100.
5. **Padrão de erros:** services lançam
   `const err = new Error(msg); err.statusCode = 4xx; throw err`.
   O `errorHandler` responde `{ message, errors? }`. Controllers **nunca**
   respondem erro direto — sempre `return next(error)`.
6. **Update por `save()`, não `findOneAndUpdate()`.** `findOneAndUpdate` não
   dispara `pre("validate")`, e regra que só vale na criação não é regra.

### Hierarquia de dados

```
User
 ├─ Client
 ├─ Process ──── ProcessoCliente ──── Client      (N:N, com papel)
 │   ├─ Fee ──── Installment ──── Payment
 │   └─ Document
 ├─ Secao
 └─ Document ─── DocumentoSecao ──── Secao        (N:N, com ordem)
```

`Process.clientePrincipalId` é **campo derivado** de `ProcessoCliente`. A
junção é a fonte da verdade; se divergirem, a junção está certa.

---

## Módulos e models reais

| Módulo           | Rotas | Controller | Service | Model(s)                        | Validation |
|------------------|-------|------------|---------|---------------------------------|------------|
| Auth             | ✅    | ✅         | ✅      | `User`                          | ✅         |
| Clients          | ✅    | ✅         | ✅      | `Client`                        | ✅         |
| Processes        | ✅    | ✅         | ✅      | `Process`, `ProcessoCliente`    | ✅         |
| Seções           | ✅    | ✅         | ✅      | `Secao`                         | ✅         |
| Documents        | ✅    | ✅         | ✅×4    | `Document`, `DocumentoSecao`    | ✅         |
| Fees             | ✅    | ✅         | ✅      | `Fee`                           | ✅         |
| Installments     | ✅    | ✅         | ✅      | `Installment`                   | ✅         |
| Payments         | ✅    | ✅         | ✅      | `Payment`                       | ✅         |
| Dashboard        | ✅    | ✅         | ✅      | — (agrega)                      | —          |
| Financeiro       | ✅    | (dashboard)| ✅×2    | — (agrega)                      | —          |
| **Portal** (3.1) | ✅    | ✅×2       | ✅×4    | `ConfirmacaoVisualizacao`       | ✅         |

**11 módulos, 12 models** (`shared/enderecoSchema.js` é sub-schema, não model).

O módulo **Financeiro** ganhou service próprio na Fase 4.1
(`financeiroService.js`, a ficha do processo, ao lado do resumo que vive em
`dashboardService.js`), e o de **Payments** ganhou o recibo
(`receiptService.js`). Nenhum model novo: os dois só leem.

O portal tem **quatro** services, pela mesma razão que o de documentos:

| Service                     | Responsabilidade                                  |
|-----------------------------|---------------------------------------------------|
| `portalAuthService.js`      | login, 401 unificado, troca de senha, reemissão    |
| `portalService.js`          | consulta — lê os models direto, sem os da advogada |
| `portalProjection.js`       | **allowlist** — monta a resposta campo a campo     |
| `confirmacaoService.js`     | confirmação de visualização, os dois lados         |

O módulo de documentos tem **quatro** services, por responsabilidade:

| Service                        | Responsabilidade                                  |
|--------------------------------|---------------------------------------------------|
| `documentService.js`           | CRUD e vínculos documento ↔ seção (ordem)         |
| `documentGenerationService.js` | Modelos, resolução de variáveis, geração, texto    |
| `documentRenderService.js`     | Timbrado e layout — **fonte da verdade do visual** |
| `documentDownloadService.js`   | Empacota PDF/DOCX, nome do arquivo, content-type   |

Ao lado deles, dois services de renderização que **não são** do módulo de
documentos, criados/extraídos na Fase 4.1:

| Service                     | Responsabilidade                                     |
|-----------------------------|------------------------------------------------------|
| `letterheadService.js`      | **Timbrado compartilhado** — cabeçalho, rodapé, fontes, medidas, nome de arquivo. Usado pelo documento **e** pelo recibo |
| `receiptService.js`         | Recibo de pagamento em PDF, sob demanda. **Não** grava `Document` |
| `financeiroService.js`      | Ficha financeira do processo (consolidação)          |

---

## Endpoints por módulo

Todos sob `/api`, todos autenticados por `authMiddleware`, exceto
`POST /auth/register` e `POST /auth/login`.

### `/api/auth`
| Verbo | Caminho          | Nota                                       |
|-------|------------------|--------------------------------------------|
| POST  | `/register`      | rate limit próprio; emite o cookie         |
| POST  | `/login`         | rate limit próprio                         |
| POST  | `/logout`        |                                            |
| GET   | `/me`            | responde `{ usuario }`                     |
| PATCH | `/me`            | perfil, endereço, OAB, advocacia, logo     |
| POST  | `/alterar-senha` | rate limit próprio                         |

### `/api/clients`
`POST /` · `GET /` · `GET /:id` · `PATCH /:id` · `PUT /:id` (alias) · `DELETE /:id`

Recusa excluir cliente que participa de processo ativo (409, diz quantos).

### `/api/processes`
| Verbo  | Caminho                                    |
|--------|--------------------------------------------|
| GET    | `/:id/clientes`                            |
| POST   | `/:id/clientes`                            |
| GET    | `/:id/clientes/:clienteId/codigo-acesso`   |
| PATCH  | `/:id/clientes/:clienteId/principal`       |
| PATCH  | `/:id/clientes/:clienteId`                 |
| DELETE | `/:id/clientes/:clienteId`                 |
| POST   | `/` · `GET /` · `GET /:id` · `PATCH /:id` · `PUT /:id` · `DELETE /:id` |

Criação com array `clientes: [{ clienteId, papel, principal }]` **em
transação**. Papéis: `autor`, `reu`, `terceiro_interessado`, `litisconsorte`.
Código de acesso é buscado **sob demanda** — nunca vem na listagem.

### `/api/secoes`
`POST /` · `GET /` · `GET /:id` · `PATCH /:id` · `DELETE /:id`

`GET /` aceita `?tipo=` e `?busca=`. A busca é **insensível a acento e a
caixa** — resolvido no regex, na Fase 2D.1. `Secao.variaveis` é **derivado**
por hook `pre("validate")` a partir do texto; nunca entrada do usuário.
`DELETE` recusa com 409 e **nomeia os documentos** que usam a seção.

### `/api/documents`

> **Ordem das rotas importa.** `/variaveis`, `/modelos` e os sub-recursos de
> `/:id` são declarados **antes** das rotas genéricas de `/:id` — na ordem
> inversa, "modelos" seria capturado como id.

| Verbo  | Caminho                          | Corpo / query                                     | Resposta                                              |
|--------|----------------------------------|---------------------------------------------------|-------------------------------------------------------|
| GET    | `/variaveis`                     | —                                                 | `{ total: 48, grupos: [{ origem, rotulo, descricao, total, variaveis: [{ chave, rotulo, descricao }] }] }` |
| POST   | `/modelos`                       | `{ nome, tipo, descricao? }`                      | `201` Document (`ehModelo: true`)                     |
| GET    | `/modelos`                       | `?page&limit&tipo`                                | página de modelos                                     |
| POST   | `/modelos/:id/gerar`             | `{ processoId*, clienteId?, honorarioId?, confirmarSobrescrita? }` | `201` Document gerado                |
| POST   | `/`                              | Document                                          | `201`                                                 |
| GET    | `/`                              | `?page&limit&processoId`                          | página de documentos                                  |
| GET    | `/:id/preview`                   | `?processoId&clienteId&honorarioId`               | `{ textoResolvido, pendencias, lacunas, … }`          |
| GET    | `/:id/download`                  | `?formato=pdf\|docx`                              | binário + `Content-Disposition`                       |
| PATCH  | `/:id/texto`                     | `{ textoResolvido }`                              | `{ documentoId, editadoManualmente, textoResolvido, lacunas }` |
| GET    | `/:id/secoes`                    | —                                                 | vínculos ordenados, com `secaoId` populado            |
| POST   | `/:id/secoes`                    | `{ secaoId, ordem? }`                             | `201` vínculo (ordem omitida ⇒ anexa ao fim)          |
| PATCH  | `/:id/secoes/reordenar`          | `{ secoes: [secaoId, …] }`                        | vínculos reordenados                                  |
| DELETE | `/:id/secoes/:secaoId`           | —                                                 | `{ message, secoesRestantes }`                        |
| PATCH  | `/:id/visibilidade-portal`       | `{ visivelPortal? }`                              | Document (omitido ⇒ alterna)                          |
| GET    | `/:id` · PATCH `/:id` · PUT `/:id` (alias) · DELETE `/:id` | | |

**Códigos de erro que a interface precisa tratar:**

| Código | Quando                                                                 |
|--------|------------------------------------------------------------------------|
| `422`  | Pendência de cadastro. `errors.pendencias[]` com `{ variavel, rotulo, origem, orientacao, opcoes? }` |
| `409`  | Regeração sobre documento **editado à mão**. Reenviar com `confirmarSobrescrita: true` |
| `409`  | Seção já vinculada ao documento (índice único)                          |
| `400`  | Cliente sem vínculo ativo com o processo; honorário de outro processo   |

`DELETE /api/documents/:id` **cascateia** soft delete nos vínculos de seção —
sem isso a seção ficava "em uso" por um documento inexistente, e a exclusão
dela era recusada para sempre.

### `/api/fees`, `/api/installments`, `/api/payments`
`POST /` · `GET /` · `GET /:id` · `PATCH /:id` · `PUT /:id` (alias) · `DELETE /:id`

`PATCH` entrou na Fase 4.1 como verbo principal das três; `PUT` fica como alias
depreciado, no padrão de `/clients`, `/processes` e `/documents`. Os dois
apontam para o mesmo handler e passam pelo mesmo `save()`, e portanto pelo mesmo
hook condicional do `Fee`.

| Verbo | Caminho | Nota |
|-------|---------|------|
| GET | `/api/payments/:id/recibo` | recibo em PDF; só pagamento **ativo**, desativado ⇒ 404 |

**Campos do `Fee` (Fase 4.1):** `percentual` e `valorBase`, os dois `null` fora
do tipo percentual. `valor` é derivado no tipo percentual — ver DEC-027.
**Campo do `Installment` (Fase 4.1):** `valorPago`, nunca escrito por rota.

**Códigos de erro do módulo financeiro**, que a tela da Fase 4.2 precisa tratar:

| Código | Chaves | Quando |
|--------|--------|--------|
| `400` | `campo` + `errors.<caminho>` | hook condicional do `Fee` reprovou um campo (só quando UM campo é responsável) |
| `400` | `campo: "valorPago"` | `valorPago` enviado no corpo de parcela |
| `409` | `dependencia`, `quantidade` | honorário com parcelas ativas; parcela com pagamentos ativos |
| `409` | `regra`, `saldoDisponivel`, `valorParcela`, `campo: "valorPago"` | pagamento excede a parcela |
| `422` | `errors.pendencias[]` | `{{percentualHonorario}}` num honorário sem percentual |

### `/api/financeiro`
| Verbo | Caminho | Resposta |
|-------|---------|----------|
| GET | `/resumo` | resumo global do escritório — contrato completo abaixo |
| GET | `/processos/:processoId` | **ficha financeira do processo** (Fase 4.1) |

#### Contrato de `GET /financeiro/resumo` — fechado na Fase 4.3 (DEC-028d)

Nove chaves de primeiro nível. As quatro primeiras existiam desde a Fase 1; as
cinco últimas cumprem a promessa da DEC-028(d), que a Fase 4.2 registrou como
não cumprida e exibiu com rótulos honestos.

| Campo | Tipo | Semântica |
|---|---|---|
| `valorContratado` | number | Σ `Fee.valor` dos honorários **vigentes** |
| `recebido` | number | Σ `Installment.valorPago` das parcelas desses honorários |
| `pendente` | number | `valorContratado − recebido` |
| `vencidas` | number | **contagem** de parcelas com status `vencido` |
| `mesReferencia` | string | `"2026-08"` — mês do **servidor**, em UTC |
| `aReceberNoMes` | number | Σ `emAberto` das parcelas que vencem no mês corrente |
| `recebidoNoMes` | number | Σ `Payment.valorPago` com `dataPagamento` no mês |
| `valorVencido` | number | Σ `emAberto` das parcelas com status `vencido` |
| `proximosVencimentos` | array | ≤ 5 parcelas não quitadas, `dataVencimento` ≥ hoje |

Cada item de `proximosVencimentos`: `{ _id, descricaoHonorario, numeroParcela,
valor, valorPago, emAberto, dataVencimento, status, processoId,
numeroProcesso }`.

**A cadeia é filtrada como a da ficha, e esse é o ponto:**

```
Process  ativo: true
  └ Fee  ativo: true  E  status ≠ cancelado
     └ Installment  ativo: true
        └ Payment   ativo: true
```

**Antes da 4.3 os dois números não fechavam.** Medido contra o seed: o resumo
dizia `valorContratado: 72000` e `recebido: 26600`, enquanto a soma das dez
fichas dava `71200` e `25800`. A diferença eram os R$ 800 do honorário
**cancelado** — que a ficha exclui desde a 4.1 — mais a parcela dele, quitada.
A advogada podia abrir as dez fichas, somar na calculadora e não chegar ao
número do painel. **Quem se ajustou foi o resumo: a ficha é o contrato
publicado e não muda.** `tests/financial/resumo.test.js` trava a igualdade
somando as fichas de verdade, processo a processo.

**`pendente` é `contratado − recebido`, e não a soma dos saldos das parcelas.**
A ficha calcula o em aberto de cada honorário como `fee.valor − pago`. A
diferença aparece no honorário ainda não parcelado por inteiro: 3.000
contratados com uma parcela de 1.000 emitida têm 3.000 em aberto na ficha e
teriam 1.000 pela outra fórmula. Duas fórmulas para a mesma pergunta divergem.

**`recebidoNoMes` sai de `Payment`, nunca de `Installment`.**
`Installment.dataPagamento` é a data em que a parcela FECHOU. Um pagamento de
julho numa parcela vencida em maio precisa contar em **julho**, que é quando o
dinheiro entrou — é essa a pergunta que o cartão do mês responde.

**As fronteiras do mês são em UTC.** `dataVencimento` e `dataPagamento` são
datas sem hora: chegam como `"2026-08-31"` e são gravadas em meia-noite UTC, e
o frontend as renderiza com `timeZone: "UTC"`. Recortar o mês no fuso local do
servidor jogaria a parcela de 01/09 para dentro de agosto num servidor a oeste
de Greenwich — e o cartão "A receber em agosto" listaria uma linha datada de
setembro.

**`getSummary` (`GET /dashboard`) NÃO foi tocado** e continua recortando o mês
em fuso local em `pagamentosRecebidosMes`. É divergência conhecida e inócua: a
Fase 4.3 tirou aquele cartão da tela, e o campo ficou sem consumidor. Removê-lo
é mudança de contrato de outra rota, para outra fase.

### `/api/portal` (Fase 3.1)

Superfície **separada**: middleware próprio (`portalAuthMiddleware`), segredo
próprio (`JWT_PORTAL_SECRET`), cookie próprio (`lex-portal-token`). Nenhuma
rota daqui usa `authMiddleware`, e nenhuma de lá usa o do portal.

| Verbo | Caminho | Nota |
|-------|---------|------|
| POST  | `/login` | público; balde de rate limit próprio; **401 unificado** |
| POST  | `/logout` | público (limpa o cookie) |
| GET   | `/sessao` | responde com senha provisória — é quem precisa saber |
| PATCH | `/senha` | troca obrigatória; **reemite a sessão** |
| GET   | `/confirmacoes/texto` | o texto que será gravado, para a tela exibir |
| POST  | `/confirmacoes` | 403 `confirmacaoExigeSenhaPropria` com senha provisória |
| GET   | `/processo` | ⬇ daqui para baixo, 403 com senha provisória |
| GET   | `/documentos` | só `visivelPortal && ativo && origem: "gerado"` |
| GET   | `/documentos/:id/download` | `?formato=pdf\|docx`; fora do escopo ⇒ **404** |
| GET   | `/confirmacoes` | histórico do próprio cliente |

**Códigos de erro estáveis** (`src/config/portalErrors.js`), que o frontend usa
para rotear:

| Código | Status | Quando |
|--------|--------|--------|
| `credenciaisInvalidas` | 401 | login — **os seis casos**, corpo idêntico |
| `sessaoPortalInvalida` | 401 | cookie ausente, expirado, assinatura errada, vínculo/cliente/processo desativado, senha trocada depois da emissão |
| `senhaPortalProvisoria` | 403 | rota de dado com senha provisória |
| `confirmacaoExigeSenhaPropria` | 403 | confirmação com senha provisória |

### Rotas da advogada acrescentadas na Fase 3.1

| Verbo | Caminho | Nota |
|-------|---------|------|
| DELETE | `/api/clients/:id/senha-portal` | revoga o acesso ao portal |
| GET | `/api/processes/:id/confirmacoes` | confirmações do processo |
| PATCH | `/api/processes/:id/confirmacoes/vistas` | marca todas as não vistas |

`GET /api/processes/:id/clientes` passa a devolver **`estadoPortal`**
(`nunca_acessou` / `acessou_sem_confirmar` / `confirmou`), de
`src/config/portalEstados.js`. **`codigoAcesso` continua fora** — só sai na rota
dedicada.

`GET /api/dashboard` ganha **`confirmacoesNaoVistas`**.

### `/api/dashboard`
`GET /` · `GET /status` · `GET /honorarios-por-mes`

**`GET /honorarios-por-mes` soma `Fee.valor` agrupando por `createdAt`** — é o
valor **contratado**, pelo mês em que a cobrança foi cadastrada, e não
recebimento. Quem responde recebimento é `recebidoNoMes`, no resumo financeiro.

**Honorário `cancelado` fica de fora desde a Fase 4.4.** Era achado reportado e
não corrigido na 4.3: o gráfico somava o cancelado enquanto o `valorContratado`
do resumo passou a excluí-lo na mesma fase. Os dois números aparecem na **mesma
tela**, e a advogada podia ler no cartão um contratado menor do que a soma das
barras logo abaixo. Mesma regra da DEC-028 e da ficha da 4.1 — a cobrança foi
desfeita. `tests/financial/graficoMensal.test.js` trava as duas pontas,
inclusive a igualdade entre a soma das barras e o `valorContratado`.


---

## Módulo de documentos — decisões fechadas

Não reabrir sem motivo novo e escrito.

1. **Uma única classe de variável.** O catálogo é o mecanismo de
   autopreenchimento. O que não vem de cadastro, a advogada escreve no editor
   de texto final. **Não existe** sintaxe de variável de preenchimento nem
   formulário na geração.
2. **O catálogo é FECHADO, em 48 chaves** — `cliente` 20, `usuario` 10,
   `processo` 9, `honorario` **7**, `sistema` 2. Eram 47 até a Fase 3.2; a
   Fase 4.1 acrescentou `percentualHonorario`, e só ela. A validação acontece no
   **cadastro da seção**, não na geração: é no cadastro que a advogada ainda
   tem contexto para corrigir um `{{nomeDoCliente}}` que ela quis escrever
   como `{{nomeCliente}}`.
3. **Toda chave precisa de rótulo e descrição escritos à mão** em
   `variableLabels.js`. `assertCatalogoRotulado()` roda na **carga do
   módulo** e derruba o processo se faltar alguma. **É intencional — não
   desativar.** Sem ela, a chave nova apareceria no seletor sem nome nenhum.
4. **Chaves da origem `usuario` no feminino** (`nomeAdvogada`, `cpfAdvogada`).
   A chave aparece na tela. Renomeado na Fase 2D.2, **sem alias de
   compatibilidade** — não há dado de produção, a única base é a do seed.
5. **Poder moderador:** ela edita o texto final sem precisar corrigir a seção
   de origem. Depois de gerado, **`textoResolvido` é a única fonte da
   verdade**. Os vínculos de seção permanecem como *rastreabilidade de
   origem* e **nunca** são recompostos — se fossem, a edição dela sumiria no
   próximo download, em silêncio.
6. **Timbrado é camada de renderização, não Seção.** Configurado uma vez no
   Perfil, aplicado a todo documento. Sem logo, o cabeçalho usa só texto e
   continua bem diagramado — sem buraco no layout.
7. **Mesma seção não repete** no mesmo documento, e duas seções não ocupam a
   mesma posição. Dois índices únicos parciais em `documento_secao`
   (`{documentoId, ordem}` e `{documentoId, secaoId}`, ambos com
   `partialFilterExpression: { ativo: true }`). O frontend **antecipa** a
   restrição; o banco é quem a garante.
8. **Reordenação em duas fases.** O índice único é verificado a cada
   operação, não ao fim do lote: reatribuir 1..N direto colide no meio do
   caminho. Fase 1 desloca tudo para um intervalo negativo temporário, fase 2
   grava as ordens definitivas — uma `bulkWrite` ordenada. A leitura
   **autocorrige** ordens < 1, caso o processo caia entre as duas fases.
9. **Empurrão de posição:** `POST /:id/secoes` com `ordem` insere na posição e
   empurra as seguintes. Ordem omitida anexa ao fim. Fora do intervalo,
   encaixa na borda mais próxima. **A regra é do backend — não reimplementar
   no frontend.**
10. **Escolha do honorário:** informado ⇒ valida que é do processo; omitido +
    1 ativo ⇒ usa esse; omitido + N ativos ⇒ **422 pedindo escolha**, com
    `opcoes[]`; omitido + 0 ativos ⇒ 422 de cadastro. **Nunca adivinhar** —
    nem "o mais recente", nem "o de maior valor". Só cobra a escolha se o
    texto realmente usa variável de honorário.
11. **Documento gerado é congelado.** `textoResolvido` e
    `variaveisResolvidas` ficam gravados e não acompanham alteração posterior
    no cadastro. `PATCH /:id` não os aceita.
12. **Regeração de documento editado à mão exige `confirmarSobrescrita`**
    (409 sem ele). Confirmada, o anterior sai por soft delete e recebe
    `substituidoPorId` apontando para o novo — a cadeia continua navegável e o
    texto revisado, recuperável.
13. **"O mesmo documento" é modelo + processo + cliente.** Regerar para outro
    cliente do mesmo processo é documento **novo**, não sobrescrita —
    litisconsórcio gera uma procuração por participante.
14. **Documento gerado registra `clienteId` e `honorarioId`** — de qual
    participante saiu a peça e de qual cobrança saíram os valores. Sem isso,
    duas procurações do mesmo modelo e processo ficam indistinguíveis na
    listagem.
15. **Lacuna é aviso, nunca impedimento.** `[...]` no texto (ou três ou mais
    sublinhados) vira `lacunas[]` na resposta. O download continua liberado.
    Pendência de cadastro, ao contrário, **bloqueia** com 422.
16. **Upload não aparece na interface.** Só documentos gerados. O campo
    `origem` (`upload` | `gerado`) e o caminho de upload ficam **dormentes**
    na API. O anteprojeto assinado exclui upload do escopo.
17. **`ehModelo` é imutável** depois da criação. Virar modelo descartaria o
    processo e deixaria um arquivo órfão. Modelo se cria por
    `POST /documents/modelos`.
18. **Modelo nunca vai ao portal** e não tem texto final editável.

### Enums do domínio

```
TIPOS_DOCUMENTO   procuracao, contrato_prestacao_servicos, declaracao_isencao_ir,
                  declaracao_autonomo, declaracao_hipossuficiencia,
                  declaracao_renuncia, peticao, sentenca, comprovante, outro
ORIGENS_DOCUMENTO upload, gerado
TIPOS_SECAO       qualificacao, objeto, clausula, fundamentacao, pedido,
                  encerramento, assinatura, outro
PAPEIS            autor, reu, terceiro_interessado, litisconsorte
STATUS_PROCESSO   ativo, encerrado, suspenso
ORIGENS_VARIAVEL  usuario, cliente, processo, sistema, honorario
```

---

## Contrato do 409 — chaves estruturadas

Fixado na Fase 2E.1. O `errorHandler` só repassa ao cliente as chaves de uma
**allowlist** (`CHAVES_ESTRUTURADAS`, em `middleware/errorMiddleware.js`);
qualquer outra propriedade pendurada no `Error` fica fora da resposta.

Existem **dois** tipos de 409, com chaves diferentes, e a diferença é
deliberada.

### 1. Conflito de campo de formulário → `campo`

Algum input que ela acabou de preencher colide com um registro existente. A
tela destaca aquele input. Valor de `campo` é o **nome do campo no payload**.

| Origem                                    | `campo`          |
|-------------------------------------------|------------------|
| `processService` — número duplicado        | `numeroProcesso` |
| `installmentService` — nº de parcela no mesmo honorário | `numeroParcela` |
| `secaoService` — título de seção duplicado | `titulo`         |
| `documentService` — seção já vinculada     | `secaoId`        |
| `clientService` — CPF/CNPJ/e-mail          | `cpf` / `cnpj` / `email` |
| `paymentService` — valor excede a parcela  | `valorPago`      |

### 2. Integridade referencial → `dependencia` + `quantidade`

A exclusão é recusada porque **outros registros ativos dependem** do que se
quer apagar. **`campo` não se usa aqui**: `campo` existe para destacar um
input, e neste 409 não há input em conflito — o conflito é entre registros já
gravados. Devolver `campo` mandaria a tela destacar um campo que não tem nada
de errado.

- `dependencia` — string do **vocabulário fechado** abaixo.
- `quantidade` — number, dependentes **ativos** encontrados. Vem da consulta
  que o service já faz para detectar o bloqueio; nunca de consulta extra.

**Vocabulário fechado de `dependencia`** — definido em
`src/config/integrityConflicts.js`, exportado como `DEPENDENCIA` (mapa) e
`DEPENDENCIAS` (array derivado do mapa, para os dois não divergirem). Os
valores são **nome da coleção dependente, em português, no plural**, seguindo
a convenção do projeto.

| Valor        | Quando                                     | Service              |
|--------------|--------------------------------------------|----------------------|
| `processos`  | cliente participa de processos ativos      | `clientService`      |
| `parcelas`   | honorário tem parcelas ativas              | `feeService`         |
| `pagamentos` | parcela tem pagamentos ativos              | `installmentService` |
| `documentos` | seção está vinculada a documentos ativos   | `secaoService`       |

**Não inventar valor novo fora dessa lista.** Ela existe porque, sem ela, em
três fases existiriam `parcelas`, `parcela` e `installments` como valores
possíveis, e o frontend voltaria a chutar.

### 3. Outra regra de negócio → `regra` + chaves próprias

Nem todo 409 é contagem de dependente. Quando não for,
`dependencia`/`quantidade` não descrevem nada e **não se força o formato**: a
regra declara as chaves que a descrevem, listadas em `REGRA_CONFLITO` no
mesmo arquivo.

| `regra`                    | Chaves que acompanham            | Quando                          |
|----------------------------|----------------------------------|---------------------------------|
| `pagamentoExcedeParcela`   | `saldoDisponivel`, `valorParcela` (numbers), e `campo: "valorPago"` | soma dos pagamentos passaria o valor da parcela |

### Regra que vale para os três

**A mensagem em prosa continua existindo e cita a quantidade e o tipo** — é o
que a advogada lê. As chaves estruturadas são para o frontend decidir o que
oferecer. Sem elas, a tela que quiser um botão "ver as 3 parcelas" extrai o
número por regex de dentro da string, que foi exatamente como a Fase 1.3
quebrou, quando o roteamento de etapa do cadastro dependia de `/mail/i` bater
na mensagem.

**O frontend ainda não consome `dependencia`/`quantidade`.** A tela que vai
usar é a ficha financeira da Fase 4. O contrato existe e está acima.

---

## Dívidas conhecidas e aceitas

- **`src/utils/texto.js` duplica `semAcento`**, que agora vive em
  `letterheadService.js` (era em `documentRenderService.js`). Registrado na
  Fase 2D.1 e **não unificado na 4.1**: a fase autorizou mexer no renderizador
  **apenas** para extrair o timbrado, e unificar `semAcento` não é isso. O que
  a 4.1 fez foi parar de duplicar a regra de NOME DE ARQUIVO — o recibo usa a
  mesma `nomeArquivoSeguro` do download de documento.
- `valorParcela` fica `undefined` quando as parcelas são desiguais. É
  honesto: dividir o total pelo número produziria um valor que não
  corresponde a nenhuma cobrança real.
- Não há `CLAUDE.md` no repositório do frontend. As convenções de interface
  estão no `README.md` e em `docs/validacao-manual.md`.

### Índices não consultados — MANTIDOS de propósito (eram três, restam dois)

Registrado na Fase 2E.1. Nenhuma consulta atual os usa. **Não remover**: o
custo no volume de hoje é desprezível, e tirar agora para readicionar em duas
fases é churn.

| Índice                          | Quem vai consultar                                    |
|---------------------------------|-------------------------------------------------------|
| `documents.substituidoPorId_1`  | a cadeia de substituição, quando existir reativação de documento |
| ~~`documents.honorarioId_1`~~   | **CONSULTADO desde a Fase 4.1** — ver abaixo          |
| `processes.clientePrincipalId_1`| leitura por cliente principal                         |

**`documents.honorarioId_1` saiu da lista.** A ficha financeira do processo
(Fase 4.1) o consulta: cada honorário traz os documentos que saíram dele —
`Document.find({ honorarioId: { $in: feeIds }, … })` em
`services/financeiroService.js`. Era exatamente a pergunta pela qual o índice
foi criado. **Restam dois** índices não consultados.

### Resíduo removível — `res.data.data ?? res.data`

Depois que a Fase 2E.1 padronizou `GET /processes/:id/clientes` e
`GET /documents/:id/secoes` no envelope, **todas** as listagens da API
devolvem `{ data, total, page, limit, totalPages }`. Os ~20 sítios do
frontend que escrevem `res.data.data ?? res.data` continuam **corretos**, mas
o fallback nunca mais dispara. Removível quando houver fase que já mexa
nesses arquivos; alterar 20 sítios só para isso é risco sem retorno.

### Decisão mantida — envelope de `/auth`

`GET /auth/me` e `POST /auth/login` devolvem `{ usuario }`. Todo outro
`GET /:id` devolve o objeto cru. É diferença **entre** módulos, consistente
**dentro** de cada um, e o `AuthContext` do frontend depende dela. **Não se
mexe** por ganho cosmético.

### Suspeita diferida — índice composto `{ usuarioId: 1, ativo: 1 }`

Toda leitura filtra por `usuarioId` **e** `ativo`, e não há índice composto
para esse par. Hoje o ganho seria imperceptível. **A confirmar com
`.explain("executionStats")` sob alguns milhares de documentos** antes de
criar qualquer índice — número, não intuição.

### DEC-029 — portal do cliente. FECHADA e implementada na Fase 3.1

Os 12 pontos ratificados, agora todos com código e teste. **Não reabrir.**

1. **Login = código de acesso + senha.** O `codigoAcesso` já existe por vínculo
   `ProcessoCliente` desde a Fase 2B, formato `LEX-XXXX-XXXX`.
2. **A senha é do CLIENTE, não do vínculo.** Campo no `Client`. Quem tem três
   processos tem três códigos e uma senha só: o código diz qual processo a
   sessão enxerga, a senha diz quem é a pessoa.
3. **Senha inicial definida pela advogada**, no fluxo de cadastro do cliente
   que já existe, e entregue junto com o código.
4. **Troca obrigatória no primeiro acesso.** Enquanto `senhaPortalProvisoria`
   for `true`, toda rota do portal responde **403** com código
   `senhaPortalProvisoria` — exceto `/sessao`, `/senha`, `/logout` e
   `/confirmacoes/texto`. Ver o bloco próprio abaixo: **este ponto não é
   conveniência.**
5. **CPF nunca é senha**, nem definitiva nem provisória. A checagem roda ANTES
   das regras de força — CPF é só dígito e reprovaria por "falta uma letra",
   dando dica de formatação em vez do motivo real.
6. **Sessão escopada ao VÍNCULO**, não ao cliente. Uma sessão enxerga um
   processo.
7. **Segredo próprio**: `JWT_PORTAL_SECRET`, cookie `lex-portal-token`. Ver o
   bloco próprio abaixo.
8. **Escopo do portal:** o processo do vínculo e os documentos com
   `visivelPortal: true`. **Sem honorário, sem financeiro, sem parcela, sem
   pagamento.**
9. **`observacoes` de cliente e de processo NUNCA vão ao portal.** São anotação
   interna da advogada sobre a parte, não informação para a parte. É o campo
   mais perigoso do schema.
10. **Outros participantes não são expostos.** O cliente vê o próprio papel,
    não a lista de litisconsortes.
11. **401 unificado** no login: os seis casos (código inexistente, vínculo
    inativo, cliente sem senha, senha errada, cliente inativo, processo
    inativo) devolvem corpo e status **byte-idênticos**, e a comparação bcrypt
    roda sempre, inclusive quando o acesso já será negado — sem isso o tempo de
    resposta reintroduziria pela lateral a distinção que o corpo único apaga.
12. **Rate limit próprio**, `RATE_LIMIT_PORTAL_LOGIN`, default 5. Balde
    separado dos três de `authRoutes.js`, com teste provando que estourar um
    não afeta o outro.

**Projeção allowlist, agora com teste.** `src/services/portalProjection.js`
monta toda resposta campo a campo, por escrita explícita. Sem spread, sem
`delete obj.x`, sem `.select("-campo")`.

Allowlist e não blocklist porque blocklist protege o schema de **hoje**: no dia
em que alguém acrescentar um campo ao `Client`, ele entra na resposta do portal
sozinho, sem ninguém decidir e sem nenhum teste falhar.

**Nenhuma rota do portal reaproveita `clientService`, `processService` ou
`documentService`.** Eles devolvem o documento inteiro; "limpar depois"
reintroduz a blocklist pela porta dos fundos, dentro de um service que ninguém
suspeita. `portalService.js` lê os models direto e projeta.

### Por que a troca de senha é obrigatória (DEC-029, ponto 4)

**Enquanto a advogada conhecer a senha, a confirmação de leitura é repudiável e
não serve como prova de que o cliente foi informado.**

Essa é a frase inteira. A senha inicial é definida pela advogada e entregue ao
cliente; enquanto for essa senha, ela consegue entrar no portal como se fosse
ele e clicar em "confirmo que li". O cliente poderia dizer, com razão, que não
foi ele — e o artefato que a Fase 3.1 existe para produzir viraria enfeite.

Consequências no código, todas com teste:

- a confirmação é **recusada** enquanto a senha for provisória, com código
  próprio (`confirmacaoExigeSenhaPropria`), distinto do 403 genérico;
- a nova senha **não pode ser igual à provisória** — "trocar" repetindo a que a
  advogada entregou marcaria a senha como definitiva com ela ainda conhecendo;
- o **acesso não é registrado** enquanto a senha for provisória: quem entra
  pode ser a advogada testando a credencial que acabou de criar, e é justamente
  esse rastro que ela vai olhar antes de afirmar que a pessoa foi informada;
- a sessão é **reemitida** na troca, e o token anterior morre (ver abaixo).

**Não remover a obrigatoriedade "para simplificar o fluxo".** Está escrito
também em `portalAuthService.trocarSenha`.

### Segredo separado, e por que o cookie não basta (DEC-029, ponto 7)

**Nome de cookie não é fronteira de segurança.** Quem controla o navegador
escolhe em qual cookie põe qual string.

Com o mesmo segredo nos dois domínios, um token de portal renomeado para
`lex-token` passaria na verificação de assinatura do `authMiddleware`, e a
única coisa entre um cliente e o cadastro inteiro da advogada seria a checagem
de `tipo` — uma condição de `if`, não criptografia. Com segredos distintos, a
assinatura não confere: a defesa vira matemática em vez de disciplina.

`assertSegredoDoPortal()` (`src/config/portalSecret.js`) roda na carga de
`src/app.js` e **derruba o processo** se `JWT_PORTAL_SECRET` faltar ou for
igual ao `JWT_SECRET`. Mesmo padrão das guardas de banco da 2E.2.

A checagem de `tipo` continua existindo **nos dois middlewares**, como segunda
tranca, para o dia em que alguém apontar as duas variáveis para o mesmo valor.

**O token carrega o carimbo da senha** (`senhaCarimbo` =
`senhaPortalDefinidaEm` em ISO). JWT não tem revogação: sem isso, "reemitir a
sessão" não invalidaria o token anterior, e o token emitido enquanto a advogada
conhecia a senha continuaria válido pelas 2 horas seguintes — a janela que a
troca obrigatória fecha ficaria aberta. O middleware já carrega o `Client` para
checar `senhaPortalProvisoria`, então a comparação não custa consulta nenhuma.

**Sessão de 2 horas**, contra `1d` da advogada. O portal é consulta — entra, lê,
confirma, sai —, não jornada de trabalho; e o código de acesso circula por
WhatsApp e por papel, então "aparelho emprestado com sessão viva" é cenário
realista, não hipótese.

### Confirmação de visualização é IMUTÁVEL e NÃO cascateia

**A cascata de soft delete é o padrão do projeto desde a Fase 2A. Esta é a
exceção deliberada.** Está escrita no model, para quem vier "corrigir por
consistência".

Desativar o vínculo, o processo ou o cliente **não** desativa as confirmações.
Elas são prova de que a informação foi entregue, e **prova que some não serve
para nada** — o valor de um recibo está em ele sobreviver ao fim da relação que
o gerou. Encerrar o processo é exatamente quando a advogada mais pode precisar
mostrar que informou.

- Nenhuma rota **altera** uma confirmação depois de criada, exceto marcar
  `vistaPelaAdvogada` (por processo, não uma a uma).
- Nenhuma rota **apaga** confirmação — nem o cliente, nem a advogada.
- Confirmações repetidas são **permitidas** e todas registradas. Confirmar
  hoje, a advogada liberar um documento amanhã, e o cliente confirmar de novo
  são dois fatos distintos, sobre conteúdos distintos. Sobrescrever apagaria a
  primeira ciência, que é a que talvez importe num prazo.

**Confirmação não é acesso.** `ultimoAcessoPortal` registra que a tela foi
aberta: é automático, é atividade e não notifica. Confirmação é clique
deliberado e é o que notifica. "O sistema registrou que a página foi aberta" e
"a pessoa declarou que leu" são afirmações de força muito diferente.

**Sem IP e sem user-agent.** Minimização de dado pessoal: o carimbo de tempo
sustenta o recibo, e aqui a advogada é controladora de dado de terceiro.

**O texto vem do backend** (`src/config/textoConfirmacao.js`), nunca do corpo da
requisição, e é **copiado inteiro** para dentro de cada registro. Se viesse do
cliente, o recibo afirmaria o que o navegador mandou. E guardar só uma
referência faria o registro de 2026 mudar de sentido quando alguém reescrevesse
a constante em 2027.

### Regerar documento visível — os DOIS caminhos, medidos na Fase 3.2

Documento novo nasce com `visivelPortal: false` (decisão de segurança do model)
e não há rota que leia documento inativo. **O comportamento é mantido de
propósito:** a alternativa é uma peça nova aparecer para o cliente sem ninguém
ter liberado.

**A Fase 3.1 registrou que "regerar um documento visível o faz desaparecer do
portal". Isso vale para UM dos dois caminhos, e a Fase 3.2 mediu os dois contra
a base do seed.** O soft delete do anterior está sob
`if (anterior && confirmarSobrescrita === true)`
(`documentGenerationService.js:483`) — sem confirmação, o anterior **não é
desativado**.

| Caminho | 409? | O anterior | O novo | O que o cliente vê |
|---|---|---|---|---|
| **Editado à mão** + `confirmarSobrescrita` | sim | soft delete, com `substituidoPorId` | invisível | **perde** o documento |
| **Não editado** | não | **continua ativo e visível** | invisível, ao lado | continua vendo a versão **ANTIGA** |

O segundo caminho é o mais comum, porque a maioria dos documentos não é editada
à mão — e era o que **não tinha aviso nenhum**, já que o aviso da 3.1 vive
dentro do 409 e o 409 só dispara para documento editado.

**Consequências, todas no frontend (`GenerationPanel.jsx`):**

- o aviso vale para **toda** regeração de documento com `visivelPortal: true`,
  antes de executar, nos dois caminhos;
- **os textos são diferentes**, porque o efeito é diferente. Um texto único
  dizendo "o documento sai do portal" estaria errado na metade dos casos, e
  errado na direção pior: a advogada acharia que o cliente ficou sem nada
  quando ele está lendo a versão velha;
- no caminho **sem 409**, liberar o documento novo **também tira o anterior do
  portal** — liberar um sem tirar o outro deixaria duas versões da mesma peça
  lá, e o cliente sem saber qual vale;
- o backend **não foi alterado**. O 409 continua carregando `visivelPortal` e
  `errors.sairaDoPortal`, e o frontend aceita as duas fontes (a chave do 409 e
  a própria consulta) para o aviso não depender de uma só.

### O portal mora no MESMO app, sob `/portal/*` (Fase 3.2)

Um build, um deploy, um domínio. O PWA existente continua valendo, não há
segundo CORS para configurar nem segundo pipeline para esquecer.

O que o portal tem de **próprio**, e por quê:

| Peça | Arquivo | Por quê |
|---|---|---|
| Instância de HTTP | `api/portalAxios.js` | ver abaixo — é a mais importante |
| Contexto de sessão | `contexts/PortalAuthContext.jsx` | dois cookies, dois segredos, dois ciclos de vida; o mesmo navegador pode ter as duas sessões |
| Portão de rota | `components/portal/PortalProtectedRoute.jsx` | sem sessão → `/portal`; senha provisória → `/portal/senha` |
| Layout | `components/portal/PortalLayout.jsx` | sem Sidebar e sem Header |
| Folha de estilo | `components/portal/Portal.css` | não importa CSS das telas da advogada |

**Tudo em `lazy()`, com chunk próprio**, no padrão de `DashboardCharts`
(`DashboardHomePage.jsx:13`). Sem isso o cliente baixaria o bundle das telas da
advogada — Financeiro, Perfil, montagem de documento, `recharts` — para ver um
processo e dois PDFs, no celular dele, na rede dele.

**Por que a instância de HTTP é separada.** O interceptor de resposta da
instância da advogada (`api/axiosConfig.js:14-26`) reage a **qualquer** 401 que
não seja de `/auth/me`, estando fora de `/login`, com
`window.location.href = '/login'` e o toast "Sessão expirada". O portal
responde 401 em dois casos **normais**: `credenciaisInvalidas` (o cliente errou
a senha) e `sessaoPortalInvalida`. Com instância compartilhada, um cliente que
errasse a senha seria arremessado para o login da advogada, em navegação de
página inteira, sem nunca ver a mensagem do próprio portal.

Interceptor no axios é **por instância**: como o portal nunca importa
`axiosConfig.js`, o de lá não enxerga resposta daqui. A separação não depende
de nenhum dos dois se comportar bem — depende de serem objetos diferentes. O
interceptor existente **não foi alterado**, e há teste travando a ausência do
import cruzado nas duas direções (`tests/portal/isolamento.test.js`).

O interceptor do portal **não mexe em `window.location`**: navegação de página
inteira recarrega o bundle e joga fora o estado do React. Ele avisa o contexto,
que navega por `useNavigate` — sempre para `/portal`.

**Sem Sidebar e sem Header** não é economia: aquelas peças são o menu de um
sistema de gestão, e nenhum daqueles destinos existe para o cliente. Exibir a
moldura de um sistema que ele não pode operar só sugere que há mais coisa
atrás.

### A tela nunca é mais rígida que a API

**Regra geral do projeto, nascida do portal.**

O caso que a fixou: o backend aceita o código de acesso em minúsculas e com
espaços **de propósito**, porque a advogada dita o código por telefone e o
cliente o recebe por WhatsApp ou num papel. Uma máscara na tela de login
recusaria `lex-77c8 8fvs`, que o servidor aceitaria — e o cliente ficaria de
fora do próprio processo por causa de uma letra minúscula, sem ter como
descobrir o motivo.

Formatar visualmente enquanto se digita é permitido. **Recusar não é.** A única
validação de cliente aceitável no login do portal é campo vazio, e há teste
travando a ausência de regex de formato, de máscara e de comparação de caixa
(`tests/portal/isolamento.test.js`).

Generalizando: quando as duas pontas divergem sobre o que é entrada válida,
**quem manda é a mais permissiva**. Validação de tela existe para poupar uma
viagem, não para inventar regra que o servidor não tem.

### A confirmação fica DEPOIS do conteúdo, nunca em modal bloqueante

O bloco de confirmação é o último da tela do processo, depois dos dados e da
lista de documentos.

**O motivo é probatório, não estético.** Um modal que exigisse confirmar para
ver inverteria o sentido do recibo: o cliente estaria declarando que leu algo
que a interface ainda não lhe mostrou. O registro continuaria sendo gravado e
continuaria dizendo "declaro que tomei ciência" — só que sobre nada. Ler
primeiro e confirmar depois é o que faz o registro valer.

Pelo mesmo motivo o texto da declaração é exibido **literalmente**, como o
backend o envia, sem reescrever, resumir ou truncar. O backend copia a mesma
constante para dentro de cada registro; se a tela mostrasse outra coisa, o
cliente concordaria com um texto e o recibo afirmaria outro.

### Redefinir a senha volta `senhaPortalProvisoria` para `true`

**É deliberado, e é o fluxo de esquecimento.** O cliente perde a senha, a
advogada cadastra uma nova no formulário do cliente, ele é obrigado a trocá-la
no próximo acesso. Não existe "recuperar senha por e-mail" no portal, e não
precisa existir: a advogada é o canal.

Consequências na interface, que a Fase 3.2 escreveu:

- a tela **diz** que gravar uma senha nova volta o acesso para provisória, no
  lugar onde a advogada vai ler;
- a senha **nunca** é exibida depois de gravada — é hash. A tela mostra
  **estado**, não valor. Se alguém pedir "mostrar a senha", a resposta é que
  não existe;
- o campo de senha **não entra no payload quando está vazio**. Sem isso,
  trocar o telefone de um cliente regravaria o acesso e derrubaria a senha que
  ele já tinha definido — campo em branco significa "não mexer", não "apagar";
- **revogar** tem rota própria (`DELETE /clients/:id/senha-portal`) e
  confirmação em dois passos, porque é ação deliberada com consequência
  imediata, não um campo esvaziado por descuido num formulário grande.

### `select: false` NÃO protege documento recém-escrito

**A armadilha do Mongoose, com ponto único de correção. Não reintroduzir.**

`select: false` no schema protege a **consulta**: o Mongoose não pede o campo
ao banco, então o documento lido não o traz. **Não protege o documento que
acabou de ser escrito.** Quem faz `new Client(...)`, atribui o hash e chama
`save()` tem o campo em memória — nenhuma consulta aconteceu, e não há `select`
que atue sobre um objeto que nunca voltou do banco.

Foi assim que `senhaPortalHash` saiu no 201 do cadastro de cliente na primeira
execução da Fase 3.1, com a listagem limpa. O `select: false` estava lá,
correto, e inútil para aquele caminho.

**O ponto único é `config/mongooseDefaults.js`**, no `toJSON` global, que atua
sobre a serialização e por isso pega os dois caminhos, para todo model. Regra
que vale para todo model não se repete em cada schema — o próximo model com
segredo esqueceria dela.

A Fase 3.2 acrescentou `tests/isolation/escrita.test.js`, que varre as
respostas de **escrita** (as de leitura já estavam cobertas) procurando o
prefixo do bcrypt na string crua do corpo. **Medido por mutação:** neutralizar
a lista de segredos do `toJSON` derruba os testes de `/clients` e **não** o do
cadastro da advogada — `POST /auth/register` passa por `sanitizeUser`
(`authService.js:57`), que monta a resposta campo a campo. São duas camadas
independentes, e agora as duas têm teste.

### Varredura de `catch` silencioso — Fase 3.2

Rodada nos dois repositórios: **88 blocos `catch` no backend, 36 no frontend**.

**Nenhum "engole erro sem sinal nenhum".** Os que não repassam nem logam têm
consequência clara e comentário:

| Local | Classificação |
|---|---|
| `middleware/portalAuthMiddleware.js:47` | engole deliberadamente — responde 401 `sessaoPortalInvalida` |
| `scripts/resetDev.js:67` | engole deliberadamente — fechar conexão no caminho de erro |
| `contexts/AuthContext.jsx:18` e `:42` | trata — limpa a sessão local |
| `pages/documents/DocumentAssemblyPage.jsx:161` | engole deliberadamente — o erro já foi exibido e relançado |
| `utils/viacep.js:26` | engole deliberadamente — contrato do módulo é "nunca lança" |
| `utils/formatters.js:5` | trata — devolve "Data inválida" |
| 7× `handleDuplicateKeyError` (backend) | trata — converte 11000 em 409 com `campo`, relança o resto |
| ~11 `catch` de tela com `toast.error` | trata — mensagem ao usuário |

**Achado deixado para uma fase futura, não corrigido:** `ClientFormPage.jsx:97`
(hoje `:117` depois desta fase) faz `if (!endereco) return;` depois da busca de
CEP. A falha é silenciosa **para o usuário**: quem digita um CEP e vê o
formulário não preencher não distingue "CEP não existe" de "ViaCEP fora do ar".
É decisão documentada no módulo (`utils/viacep.js:1-2`), e o caminho **não** é
tocado por esta fase — entra como achado, não como correção de passagem.

### Fora do portal por decisão: honorário e financeiro

**Não é esquecimento**, e a Fase 4.1 **não reabriu** a decisão.

O motivo original era que `Fee.status` não era derivado e a DEC-027/028 ia
reescrever o vocabulário do módulo — exibir número financeiro seria mostrar,
**para a pessoa errada**, um valor que ninguém mantém. A Fase 4.1 fechou o
financeiro e a decisão **segue a mesma**: o portal é de acompanhamento do
processo, e o extrato de honorários da advogada não é informação que o cliente
precise ver ali. Ele recebe o recibo do que pagou, que é outra coisa.

A varredura de `tests/portal/consulta.test.js` passou a incluir os nomes de
campo novos — `percentual`, `valorBase`, `valorPago`, `saldoDisponivel`,
`contratado`, `emAberto`, `parcialmente_pago` — em **todas** as rotas de dado do
portal. Nomes de campo, e não só valores: um campo pode sair zerado hoje e
preenchido amanhã, e a varredura precisa cair na primeira vez.

### DEC-027 — EXECUTADA na Fase 4.1, em commit único

Registrada na Fase 2E.2 como **um bloco só, não três itens espalhados** — três
coisas num commit é onde se esquece uma. Saiu assim.

**Commit: `dde2289`** — `feat(honorarios): DEC-027 — hook condicional, save() e
`campo` no mesmo commit`. Os três pedaços, no mesmo diff:

| Pedaço | Onde |
|---|---|
| 1. hook condicional de `percentual`/`valorBase` | `models/Fee.js` |
| 2. `updateFee` de `findOneAndUpdate` para `save()` | `services/feeService.js` |
| 3. `campo` nos erros de campo | `services/feeService.js`, `middleware/errorMiddleware.js` |

**1. O hook.** `pre("validate")` no `Fee`: `percentual` obrigatório no tipo
percentual e **recusado** nos demais; `valorBase` obrigatório sempre que houver
percentual; faixa maior que zero e no máximo 100. Uma mensagem por campo, em
português — `invalidate` com string produz `kind: "user defined"`, que o
`errorHandler` repassa literalmente em vez de traduzir o texto cru do driver.

**2. O `save()`.** Era o único ponto do service fora do `save()`.
`runValidators: true` roda validador de **caminho**, e não `pre("validate")`: a
regra do item 1 precisa enxergar `tipo`, `percentual` e `valorBase` juntos, e
não teria como rodar por ali. O update é justamente onde a advogada troca o tipo
de cobrança — era o caminho que ficaria sem regra. `createFee` também passou a
`new` + `save()`, para as duas gravações seguirem o mesmo caminho.

**3. O `campo`.** Sai quando **exatamente um** campo é responsável. Com dois,
destacar o primeiro esconderia o segundo: a advogada corrigiria um, reenviaria e
levaria o mesmo 400. O `errorHandler` repassa `campo` no 400 de
`ValidationError` **só** quando um service o anexou de propósito — nunca
deduzido de "só um caminho falhou", que mudaria a resposta de todo módulo de
uma vez.

**Uma correção de premissa.** O roteiro falava em "emitir `campo` nos 409 do
`feeService`". O `feeService` **não tem** 409 de conflito de campo, e não
passou a ter: o `Fee` não tem índice único nenhum, e inventar uma regra de
unicidade para justificar o 409 seria mudança de negócio não pedida. Os erros
de campo do honorário são **400** — os do hook e os da validação escrita à mão
—, e é neles que `campo` passou a sair. O `getApiErrorField` do FeeFormPage lê
`data.campo` **independente do status** (`utils/apiError.js:19`), então o helper
saiu de inerte do mesmo jeito, que era o objetivo.

O **409 de integridade** do `deleteFee` continua **sem** `campo`, com
`dependencia` + `quantidade`. Não há input em conflito ali: há parcela gravada.
`tests/financial/honorario.test.js` trava as duas pontas no mesmo bloco.

### DEC-028 — status do honorário derivado das parcelas (Fase 4.1)

`Fee.status` deixou de ser escrita explícita. **Commit: `d1f876d`.**

| Estado | Quando |
|---|---|
| `pendente` | nenhuma parcela ativa com pagamento |
| `parcialmente_pago` | ao menos uma parcela paga, nem todas |
| `pago` | todas as parcelas ativas quitadas |
| `cancelado` | **apenas por escrita explícita** |

**`cancelado` NUNCA é sobrescrito pelo recálculo.** Honorário cancelado não vira
"pago" porque alguém quitou uma parcela antiga — a cobrança foi desfeita, e o
dinheiro que entrou depois é outro assunto. Está escrito como **guarda com
`return` próprio** em `recalcularStatusFee`, e não como efeito da ordem dos
`if`: ordenação de condição some na primeira vez que alguém a reorganiza "para
ficar mais legível", e some em silêncio.

Descancelar é escrita explícita, e aí a derivação volta a valer. Sem isso a
guarda deixaria o honorário preso para sempre.

**Onde se pendura.** Na **mesma cadeia** que já recalculava a parcela:
`recalcularStatusInstallment` (`paymentService.js`) chama `recalcularStatusFee`
no fim. Todo caminho que grava ou desativa pagamento já passava por ela. **Não
há segundo caminho paralelo.**

Dois pontos que a cadeia de pagamento não alcança ganharam chamada explícita,
porque mudam o **conjunto** de parcelas e não o pago de uma delas:

- `deletarInstallment` — a parcela sai do conjunto, e
  `recalcularStatusInstallment` devolveria `null` por filtrar `ativo: true`;
- `atualizarInstallment` quando muda o `feeId` — o honorário de **origem**
  também precisa recalcular, senão fica `parcialmente_pago` para sempre.

`feeService` reconcilia depois de criar e de atualizar: `status` no corpo vale
como intenção, e as parcelas decidem.

**Honorário SEM parcela nenhuma é `pendente`.** A Fase 2C decidiu que, para as
variáveis de template, honorário sem parcela vale como pagamento único — uma
parcela do valor cheio. A leitura aqui é a mesma, levada até o fim: essa parcela
existe e **não foi paga**, porque pagamento pendura em parcela e não há nenhuma.
Chamar de `pago` um honorário que nunca recebeu um centavo seria o pior erro
possível neste módulo.

A derivação é feita sobre `Installment.status`, que já é derivado, e **não**
sobre uma segunda soma de pagamentos: `pago` é exatamente `totalPago >= valor` e
`parcial` é exatamente `0 < totalPago < valor`. Duas fórmulas para a mesma
pergunta divergem.

**O teste da Fase 2E.2 foi INVERTIDO, não apagado**, no mesmo arquivo
(`tests/financial/chain.test.js`), com comentário dizendo que é a DEC-028 e em
que fase ocorreu. O histórico do Git mostra a transição deliberada em vez de um
teste que sumiu.

### `valor` é o campo único que o resto do sistema lê

No honorário percentual ele é **calculado pelo hook**, a partir de `percentual`
× `valorBase`, arredondado em centavos. Nos demais é o que a advogada digitou.

**Nenhum consumidor precisa saber o tipo.** Catálogo de variáveis, dashboard,
gráfico de honorários por mês, ficha financeira e recibo leem `valor` e pronto.
O que vier em `valor` no corpo de um honorário percentual é **descartado**: ali
o valor não é opinião, é conta.

Consequência para a Fase 4.2: no formulário de honorário percentual, o campo de
valor é **exibição**, não entrada.

### `valorPago` da parcela NUNCA é escrito por rota

`Installment.valorPago` é a soma dos pagamentos **ativos** da parcela. Pagamento
desativado sai da soma, porque a soma é **refeita** a cada recálculo em vez de
incrementada.

**Um único ponto de escrita:** `recalcularStatusInstallment`, que já computava
`totalPago` para decidir o status. `installmentService` **recusa com 400** quem
mandar `valorPago` no corpo, com `campo: "valorPago"` e mensagem apontando
`POST /payments`. Recusa explícita, e não descarte silencioso: quem mandou o
campo acreditava estar registrando um recebimento, e o silêncio o deixaria
achando que registrou.

**O 409 de excedente NÃO lê este campo.** Continua somando os pagamentos por
consulta, porque o caminho de atualização precisa excluir o próprio pagamento em
edição do total — coisa que um valor desnormalizado não sabe fazer. As quatro
chaves e o `saldoDisponivel` seguem idênticos.

### O timbrado é COMPARTILHADO entre documento e recibo

`src/services/letterheadService.js`, extraído de `documentRenderService.js` na
Fase 4.1 — primeira alteração naquele arquivo desde a Fase 2C, autorizada
apenas para isto. **Commit: `6bf572c`.**

Cabeçalho, rodapé, fontes, medidas e a normalização de nome de arquivo moram
lá. O motivo é o recibo, que sai sobre o mesmo papel: duplicar a montagem
garantiria divergência — em seis meses o cabeçalho do documento e o do recibo
não seriam mais o mesmo, e ninguém notaria até a advogada colocar os dois lado a
lado.

| Arquivo | Fonte da verdade de |
|---|---|
| `letterheadService.js` | o **papel** — o que documento e recibo têm em comum |
| `documentRenderService.js` | o visual do **documento** — corpo, parágrafos, justificação |

**A extração se sustentou.** Foi refatoração pura, conferida por comparação do
texto extraído do PDF antes e depois, com `renderizarPdf` chamado direto sobre
um usuário literal — sem banco, saída determinística — nos dois caminhos do
timbrado, com logo e sem. Diff vazio. O canário do documento editado à mão
continua verde, e ganhou asserção sobre o timbrado dentro do mesmo PDF.

`montarTimbrado` segue exportado de `documentRenderService.js` por
compatibilidade: é de lá que ele é importado desde a Fase 2C.

### O recibo NÃO é um `Document`

`GET /api/payments/:id/recibo`. **Commit: `307ba01`.**

Não cria registro na coleção de documentos, **não tem `visivelPortal`, não entra
no portal**, não aparece na lista do processo. É emissão sob demanda: o PDF é
montado, entregue e esquecido — e há teste provando que emitir duas vezes não
muda a contagem de `/documents`.

`Document` é peça composta por seções, com texto resolvido, rastreabilidade de
origem e poder moderador da advogada sobre o texto final. O recibo não tem nada
disso: é **função do pagamento**, e o pagamento já está gravado. Gravá-lo de
novo criaria dois lugares dizendo a mesma coisa, livres para divergir quando o
pagamento fosse corrigido.

Só pagamento **ativo** — desativado responde 404. Recibo de pagamento estornado
é justamente o papel que não pode existir. A cadeia inteira é conferida sob
`{ usuarioId, ativo: true }`: parcela, honorário e processo desativados também
dão 404.

Quem paga é o participante **principal** do processo, lido da junção
`ProcessoCliente` (a fonte da verdade desde a Fase 2B), com `clientePrincipalId`
como segunda tentativa. Num litisconsórcio os demais são partes do processo, não
do contrato de honorários.

### Vocabulário de tipo de honorário — PENDENTE DE RATIFICAÇÃO

```
TIPOS_HONORARIO    fixo, percentual, custas
STATUS_HONORARIO   pendente, parcialmente_pago, pago, cancelado
```

Os dois estão em `src/models/Fee.js`, exportados, e `feeValidation.js` os
**importa** em vez de reescrever — duas listas escritas à mão divergem na
primeira fase que acrescentar um valor.

**`TIPOS_HONORARIO` precisa de ratificação da advogada antes de a Fase 5
documentar.** Os três valores vêm da Fase 1 e nunca foram conferidos com ela: é
vocabulário jurídico da prática dela, não decisão técnica. "Custas" é despesa
processual e não honorário, e pode ser que o lugar dela não seja este enum;
"êxito" e "sucumbência" podem ser tipos que faltam. **Nada disso se decide
aqui.** `STATUS_HONORARIO`, ao contrário, é vocabulário do sistema e está
fechado pela DEC-028.

### Envelope é contrato de LISTAGEM, não de resposta em geral

Registrado na Fase 2E.2. O envelope
`{ data, total, page, limit, totalPages }` descreve uma **listagem**. Em
resposta de **mutação**, `total`, `page` e `limit` não descrevem nada.

Por isso `PATCH /documents/:id/secoes/reordenar`
(`documentController.js:159`) devolve **array cru de propósito**. Não é
divergência a corrigir, e uma varredura literal vai continuar acusando — é
falso positivo conhecido.

A Fase 2E.1 padronizou as **duas listagens** que faltavam
(`GET /processes/:id/clientes` e `GET /documents/:id/secoes`) e **parou aí,
corretamente**.

**A ficha financeira do processo (Fase 4.1) NÃO usa o envelope.** É a segunda
resposta do projeto a ficar de fora, e pelo mesmo motivo do array cru da
reordenação: ali não há listagem. Há **um** processo, com uma árvore embaixo e
três totais em cima.

`page` e `limit` não descreveriam nada, e paginar honorário seria pior do que
inútil — partiria o total ao meio, e a advogada leria "recebido" de meia ficha.

A forma escolhida é um objeto com quatro chaves de primeiro nível:

```
{
  processo:   { _id, numeroProcesso, titulo, status, tipoAcao },
  totais:     { contratado, pago, emAberto, honorarios, honorariosCancelados },
  honorarios: [ { …, totais: { contratado, pago, emAberto },
                  parcelas: [ { …, valorPago, emAberto, pagamentos: [ … ] } ],
                  documentos: [ … ] } ],
  geradoEm:   Date
}
```

Os totais são calculados no **backend**, em três níveis. A tela não faz conta:
somar no frontend seria somar o que foi baixado, e no dia em que a ficha ganhar
recorte o total viraria o do recorte sem ninguém notar.

Honorário **cancelado** fica fora de `contratado` — a cobrança foi desfeita, e
somá-la faria a advogada ler como devido um valor que ela mesma cancelou. Ele
continua na lista, com o status à vista e com contagem própria em `totais`:
sumir da ficha levaria junto o histórico.

`tests/financial/ficha.test.js` trava a AUSÊNCIA de `data`, `page`, `limit`,
`totalPages` e `total`, para que uma uniformização futura caia no teste.

### Risco conhecido de dependência do frontend — a conta honesta

Registrado na Fase 2E.2. Se alguém rodar `npm audit` na defesa, a resposta
precisa estar escrita. **Resposta honesta é melhor que otimista**, e por isso
o registro não é "15 → 7".

**O que se ganhou.** A atualização da Fase 2E.1 fechou **3 vulnerabilidades
de produção que atingiam o navegador**: `axios` 1.13.2 → 1.19.0 (alta),
`form-data` 4.0.4 → 4.0.6 (alta), `follow-redirects` 1.15.11 → 1.16.0
(moderada). **O bump do `axios` se pagou.**

**O que não se ganhou.** O bump do `react-router-dom` de 7.9.5 para 7.18.2
foram **nove minors e não fechou a vulnerabilidade**.
`react-router-dom@7.18.2` fixa `react-router: "7.18.2"` exato, não existe
`react-router-dom` 8.x, e a correção de **GHSA-qwww-vcr4-c8h2** está em
`react-router@8.3.0`, major. Ou seja: **assumimos risco de regressão sem
ganho de segurança naquele pacote.** Manter a versão nova é decisão de
**coerência de lockfile, não de benefício**.

**Por que o risco residual é aceito.** O **modo RSC não é usado**: o app é
SPA com `BrowserRouter`, e as 11 APIs de `react-router-dom` em uso
(`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `Navigate`,
`Outlet`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`)
resolvem em 7.18.2 sem depreciação. **O caminho vulnerável não existe neste
código.**

**As outras 5** (`brace-expansion`, `minimatch`, `@eslint/*`) exigem
`eslint@10`, major, e **não saem no build** — são cadeia de desenvolvimento.

---

## Limites permanentes

- **Nenhuma dependência nova** sem decisão explícita. Subir a *versão* de
  pacote existente, dentro do semver, para fechar vulnerabilidade, não conta
  como dependência nova.
- **Nunca `npm audit fix --force`** — sobe major de Express/Mongoose e quebra
  a API.
- **Não alterar `documentRenderService.js`** fora de fase que o tenha no
  escopo. O mesmo vale agora para **`letterheadService.js`**, que saiu de
  dentro dele na Fase 4.1 e é onde o timbrado passou a morar: mexer ali muda o
  papel do documento **e** o do recibo de uma vez.
- **Não alterar o catálogo de variáveis.** Divergência encontrada se
  **reporta**, não se corrige de passagem.
- Não mexer em `Fee` nem no financeiro fora da Fase 4. Não criar portal fora
  da Fase 3. A Fase 4.1 fechou o **backend** financeiro; a 4.2 é de tela e
  **não** reabre model, service nem contrato de rota.
- **Não reescrever histórico publicado.** Sem `rebase`, `reset --hard` ou
  `push --force` sobre `main`. Correção de coisa mergeada é commit novo, para
  a frente.
- Não expor secrets, senhas, tokens, strings de conexão ou IPs. Não alterar
  `.env`.
- **Confirmação de visualização não cascateia e não se apaga.** Exceção
  deliberada ao soft delete — ver DEC-029.
- Não remover regra de isolamento (`usuarioId`) nem filtro `ativo: true`.
- `git push` só com confirmação explícita.
- **Nenhuma rota do portal reaproveita service da advogada.** Ler o model
  direto e projetar por `portalProjection.js`.

---

## Comandos

```bash
npm run dev            # nodemon src/server.js — porta 3001
npm start              # node src/server.js
npm run seed:fresh     # reset + seed (derruba e repovoa)  ← o usual
npm run seed:demo      # só popula
npm run reset:dev      # só derruba (bloqueado em produção)
```

Conta do seed: **demo@lex.dev** / **Lex123456**

Portal do cliente (Fase 3.1): senha **provisória** `Portal2026` (Ana Lima) e
senha **própria** `MinhaSenha2026` (Maria e Joao, do litisconsórcio). O código
de acesso de cada vínculo sai no resumo final do seed.

### Contagens esperadas do seed

| Coleção            | Qtde |
|--------------------|------|
| `clients`          | 8    |
| `processes`        | 10   |
| `processo_clientes`| 12   |
| `fees`             | 12   |
| `installments`     | 20   |
| `payments`         | 11   |  ← ativos; há **+1 desativado**, fora da soma |
| `documents`        | 19   |
| `secoes`           | 11   |
| `documento_secao`  | 41   |
| `confirmacoes_visualizacao` | 2 |

**Estados financeiros do seed (Fase 4.1):** os quatro derivados estão
presentes — `cancelado` 1, `pago` 2, `parcialmente_pago` 4, `pendente` 5. O
`cancelado` tem a parcela **integralmente paga**: é o caso que prova a guarda da
DEC-028, e o resumo do seed imprime os estados justamente para que ele apareça.
O seed exercita **48 de 48** chaves do catálogo, contadas do banco e não das
constantes, e confere ativamente o **422** de `{{percentualHonorario}}` num
honorário fixo.

**Lacunas intencionais do seed — não são bug:**
- Beatriz Ramos Pereira (PF) **sem `profissao`** → gerar para "Usucapião de
  Imóvel Urbano" retorna 422 apontando `{{profissaoCliente}}`. Serve para ver
  a tela de pendência.
- Agro Campos Gerais Ltda (PJ) **sem representante legal** → exibe os dois
  estados na tela de detalhe.
- "Inventário e Partilha de Bens" tem **2 participantes** (litisconsórcio) e
  **2 procurações** do mesmo modelo, uma por outorgante.
- 1 documento **editado à mão** e 1 documento **com lacuna `[...]`**.

---

## Repositórios

- Backend: https://github.com/lexuepg2026-droid/LEX-back
- Frontend: https://github.com/lexuepg2026-droid/LEX-front

---

## Rotina de encerramento de sessão

Antes de fechar qualquer sessão, peça:

> "Atualize o CLAUDE.md com o que foi feito hoje, os arquivos alterados,
> decisões tomadas, pendências e próximo passo recomendado."

---

## Registro de sessões

> As sessões de 2026-05-06 a 2026-05-12 estão preservadas no fim do arquivo,
> na forma original. Da Fase 1.3 em diante o registro passa a ser **por
> fase**, que é como o trabalho passou a ser organizado.

### Fase 1.3 — Correções de contrato da API

**Resumo:** erros do Mongoose passam a virar 4xx em vez de 500; `campo` nos
409 para o frontend destacar o input certo; `PATCH` adotado como verbo de
update; limitador de senha separado do de login.

**Decisões:** update por `save()` e não `findOneAndUpdate()` — só assim o
`pre("validate")` roda e a validação condicional do schema vale também no
update. `PUT` fica como alias depreciado onde já existia.

**Commits:** `7342d36`, `8f55a5e`, `4e28b4b`, `7a7b88c`, `94fcc43`

---

### Fase 2A — Composição por seções, modelos e geração

**Resumo:** nasce o módulo de documentos como composição. Models `Secao` e
`DocumentoSecao`, catálogo de variáveis, CRUD de seções, vínculos com ordem,
modelos e geração com substituição de variáveis.

**Decisões:** catálogo **fechado**, validado no cadastro da seção e não na
geração. Reordenação em **duas fases** por causa do índice único
`{documentoId, ordem}`. Empurrão de posição no `POST /:id/secoes`.
Autocorreção de ordens inválidas na leitura, em vez de transação, porque a
janela de risco é de milissegundos.

**Commits:** `c5c45f9`, `6baf864`, `7f61c6c`, `d44c870`, `0dcf4ed`

---

### Fase 2B — Participantes do processo

**Resumo:** um processo passa a ter **vários** clientes, com papel. Model
`ProcessoCliente` (junção N:N), `Process.clienteId` renomeado para
`clientePrincipalId`, endpoints de participantes, código de acesso sob
demanda, e geração recebendo o cliente **explicitamente**.

**Decisões:** a junção é a fonte da verdade; `clientePrincipalId` é derivado e
existe só para leitura rápida. Criação de processo com array de participantes
**em transação**. Cliente informado sem vínculo ativo é **400** — emitir
procuração qualificando quem não é parte é o erro que a checagem impede.
Regerar para outro cliente do mesmo processo é documento **novo**.

**Commits:** `93414ab`, `9a1893b`, `8e1265f`, `3fcb453`, `19452b7`,
`dd82385`, `7e28842`

---

### Fase 2C — Renderização, honorário e lacunas

**Resumo:** download em PDF e DOCX com timbrado, logo do escritório em
`advocacia.logoBase64`, variáveis de honorário (inclusive valor por extenso),
escolha do honorário quando há ambiguidade, texto final editável e detecção de
lacunas.

**Decisões:** `documentRenderService.js` é a **fonte da verdade do visual** —
timbrado é camada de renderização, não Seção. Nunca adivinhar qual honorário
alimenta o contrato: N ativos ⇒ 422 pedindo escolha. Lacuna avisa e **não**
bloqueia; pendência de cadastro bloqueia. Limite do corpo JSON elevado a
400 kb para caber o logo em base64. `pdfmake` mantido em 0.3.11.

**Commits:** `ad5ad7f`, `d501591`, `1acc9bf`, `c812b43`, `9033028`,
`721421f`, `b8e218f`, `fd0e5c9`

---

### Fase 2D.1 — Biblioteca de Seções e catálogo rotulado

**Resumo:** catálogo ganha rótulo e descrição escritos à mão para cada chave,
com guarda de carga; busca de seções insensível a acento; correções pendentes
da 2C e anteriores.

**Decisões:** rótulo e descrição **nunca derivados da chave** — derivação
produz "Nome Cliente", "Cpf Cliente", que funciona e parece amador.
`assertCatalogoRotulado()` roda na carga do módulo e **derruba o processo** se
faltar rótulo. Contagem do catálogo fixada em **47** (a auditoria da 2C falava
em 45 por erro de contagem, não divergência real).

**Achados reportados e deixados para depois:** 6 vulnerabilidades no
`npm audit`; chaves do catálogo no masculino com rótulo no feminino;
`CLAUDE.md` desatualizado; `src/utils/texto.js` duplicando `semAcento`.

**Commits:** `2bad694`, `60d885b`, `0792745`
**Merge em `main`:** `bca674a`

---

### Fase 2D.2 — Tela de montagem, texto final e download

**Resumo:** manutenção herdada da 2D.1 e a tela de montagem de documentos no
frontend.

**Manutenção (backend):**
- `npm audit`: 6 → 0 vulnerabilidades, via `npm update` dentro do semver.
  **`package.json` não mudou uma linha** — todas as correções couberam nos
  ranges já declarados. `path-to-regexp` 8.3.0→8.4.2, `mongoose` 9.3.2→9.8.1,
  `body-parser` 2.2.2→2.3.0, `qs` 6.15.0→6.15.3, e as duas de `nodemon`
  (`brace-expansion`, `picomatch`) saíram junto.
- `nomeAdvogado` → `nomeAdvogada`, `cpfAdvogado` → `cpfAdvogada`. Eram as
  **únicas duas** chaves com gênero na origem `usuario`; as outras oito não
  têm. Sem alias. Catálogo segue em 47, guarda passando, texto resolvido
  byte-idêntico ao de antes.
- Este `CLAUDE.md`, reescrito: eram 7 módulos documentados contra 10 reais,
  sem `Secao`, `DocumentoSecao` nem `ProcessoCliente`, e o último registro era
  de 2026-05-12.

**Achados que NÃO se reproduziram** (a 2D.1 os reportou, mas a `main` atual já
está correta — verificado, nada alterado):
- `DocumentFormPage.jsx` com indentação corrompida e chaves órfãs nas linhas
  30–36: o arquivo está bem-formado, sem tabs, sem CRLF, sem espaço em fim de
  linha, indentação de 2 espaços consistente.
- `ClientPage.css` usando `--bg-button`, `--text-button` e `--bg-color`
  inexistentes: os três **existem**, no bloco "Legado" de `variables.css`,
  declarados em `:root` **e** em `body.light-mode`. Varredura completa dos
  `.css` e `.jsx`: **63 tokens consumidos, 0 inexistentes.**

**Decisões:** o `DocumentFormPage.jsx` é formulário de **upload**
(`urlArquivo` obrigatório), e a decisão 16 tira upload da interface. Ele
segue vivo e fora da navegação nova — remover é decisão de outra fase.

---

### Fase 2E.1 — Correções da auditoria geral

**Resumo:** vulnerabilidades do frontend, 409 com informação estruturada,
envelope das duas listagens que faltavam, tratamento de erro nas telas,
`PATCH` no processo, remoção de código morto e `__v` fora da saída JSON.

**Backend:**
- `config/integrityConflicts.js` (novo) — vocabulário fechado de
  `dependencia` e das regras de conflito. Contrato completo documentado
  acima, em "Contrato do 409".
- `config/mongooseDefaults.js` (novo) — `toJSON` global tirando `__v` da
  saída. **Não** `versionKey: false`: o `__v` continua gravado, verificado
  por consulta direta ao driver. As duas consultas com `.lean()` do projeto
  (`listProcesses` e `getProcessById`) resolvem por `.select("-__v")`, porque
  `lean()` não passa por `toJSON`.
- `errorHandler` com **allowlist** de chaves estruturadas, em vez de repassar
  propriedade do `Error` por nome solto.
- `GET /processes/:id/clientes` e `GET /documents/:id/secoes` no envelope
  padrão, montado no service como todos os outros.

**Frontend:**
- `npm update` dentro do semver: 15 → 7 vulnerabilidades. As 3 de produção
  fecharam (axios, form-data, follow-redirects). `package.json` não mudou
  uma linha — só o lock.
- 13 telas passam a usar `getApiErrorMessage`; as 2 de detalhe deixam de
  mentir sobre a causa; os 4 formulários que faltavam passam a destacar o
  campo do 409 (7 de 7 agora).
- Apagados `components/ui/Button.jsx`, `Card.jsx` e `Card.css`.
  **`Button.css` continua**, importado por `PageHeader.jsx`.

**Decisões:**
- **`campo` não entra em 409 de integridade referencial.** Ele existe para
  destacar input, e ali o conflito é entre registros gravados. Ver o contrato
  acima — é a decisão central desta fase.
- O 409 de excedente de pagamento **não** foi forçado no formato
  `dependencia`/`quantidade`, que não descreveriam nada nele. Ganhou `regra`,
  `saldoDisponivel`, `valorParcela` — e `campo: "valorPago"`, porque ali
  existe input em conflito de verdade.
- `secaoService.deleteSecao` recebeu as duas chaves de integridade sem estar
  na lista da auditoria: era o único 409 de integridade que ficaria falando
  língua diferente, e é isso que o vocabulário fechado existe para evitar.

**Onde um serviço de relato de erro se ligaria:** os 6 `console.error` de
`catch` do frontend foram removidos — a mensagem ao usuário permanece. É
**exatamente nesses `catch`** que um Sentry/Rollbar entraria, se um dia
existir: `ClientFormPage`, `ClientDetailPage`, `ProcessFormPage`,
`ProcessDetailPage` (2) e `LoginPage`. Os logs do **backend** não foram
tocados — são saída de CLI, log operacional ou diagnóstico documentado.

---

### Fase 2E.2 — Suíte de testes automatizados

**Resumo:** primeira coisa executável do repositório. 101 testes no backend
(`node --test`, sem dependência nova) e 47 no frontend, mais varredura estática
de classe CSS, correção dos defeitos que ela achou e o roteiro manual de 83
para 79 passos.

**Backend:** infraestrutura em `tests/helpers/` — guarda de banco que aborta se
a URI apontar para `lex` ou para banco sem "test" no nome, app em porta
efêmera, pote de cookies sobre `fetch` nativo, fábricas com CPF/CNPJ de dígito
válido, e extração de texto de PDF com `node:zlib` (ToUnicode CMap), sem
instalar nada. Blocos: isolamento (86 tentativas, 0 vazamentos), cadeia
financeira, geração de documento, invariantes de vínculo.

**Achados reportados e NÃO corrigidos:** `Fee.status` não é derivado das
parcelas — teste trava o comportamento atual para a Fase 4 cair nele; e a
cadeia de `substituidoPorId` está gravada mas não é navegável pela API, porque
não há rota que leia documento inativo.

**Frontend:** varredura de "classe aplicada sem regra alcançável", que achou 3
defeitos reais — `ui-btn` inalcançável em 3 telas e no `Modal`, `.wizard-step` e
`.breadcrumb-item` sem regra em lugar nenhum. Corrigidos. `utilities.css`
apagado.

---

### Fase 3.1 — Portal do cliente: backend, confirmação e suíte

**Resumo:** primeira vez que o LEX expõe dado a alguém que não é a advogada.
Autenticação própria por código de acesso + senha, projeção allowlist,
confirmação de visualização imutável, e 69 testes novos (101 → 170).

**Arquivos novos:** `config/portalSecret.js`, `config/portalErrors.js`,
`config/portalEstados.js`, `config/textoConfirmacao.js`,
`models/ConfirmacaoVisualizacao.js`, `services/portalAuthService.js`,
`services/portalService.js`, `services/portalProjection.js`,
`services/confirmacaoService.js`, `controllers/portalAuthController.js`,
`controllers/portalController.js`, `middleware/portalAuthMiddleware.js`,
`routes/portalRoutes.js`, `validations/portalAuthValidation.js`.

**Decisões**, todas com o porquê nos blocos acima: segredo separado com guarda
de subida; token carregando o carimbo da senha para a troca invalidar o
anterior; sessão de 2h; 401 unificado com bcrypt rodando sempre; texto da
confirmação vindo do backend e copiado para dentro do registro; confirmação
imutável e sem cascata; contador de não vistas dentro de `getSummary` em vez de
rota nova.

**Quatro defeitos meus, achados por teste antes do commit:** `select: false`
não protege o documento recém-escrito (o hash saía no 201 de cadastro, e a
correção foi centralizar em `mongooseDefaults.js`); a recusa de CPF como senha
estava inalcançável por ordem das checagens; o registro de acesso corria com a
requisição seguinte e o pipeline nem funcionava, porque o Mongoose 9 exige
`updatePipeline: true` e um `catch` silencioso engoliu o erro; e
`POST /confirmacoes` estava montado depois do portão genérico, então o código
de erro específico nunca saía.

**Isolamento:** 66 rotas da advogada e 8 do portal varridas nas duas direções,
86 tentativas cruzadas, 20 respostas varridas campo a campo, **0 vazamentos**.

**Não tocado:** frontend (Fase 3.2), `Fee`/`Installment`/`Payment`,
`documentRenderService.js`, catálogo de variáveis, envelope de `/auth`.

---

### Fase 3.2 — Portal do cliente: interface, confirmação e lado da advogada

**Resumo:** a interface do portal, no mesmo app Vite, sob `/portal/*`, em chunk
próprio; o lado da advogada (senha de portal, entrega do código, selo por
participante, histórico de confirmações, contador no dashboard); e a correção
do aviso de visibilidade na regeração. Backend 170 → 176 testes, frontend
47 → 65.

**Backend — só verificação e um teste novo.** `tests/isolation/escrita.test.js`
(6 testes): as varreduras da 2E.2 e da 3.1 cobriram respostas de LEITURA;
faltava a de ESCRITA, que é onde a falha já aconteceu. Resultado: **não há
vazamento**, e o motivo não é o que se supunha — ver "`select: false` não
protege documento recém-escrito", acima. Nenhum arquivo de produção do backend
foi alterado nesta fase.

**Frontend — arquivos novos:** `api/portalAxios.js`, `api/portalService.js`,
`contexts/PortalAuthContext.jsx`, `components/portal/PortalLayout.jsx`,
`components/portal/Portal.css`, `components/portal/PortalProtectedRoute.jsx`,
`components/portal/PortalDocumentList.jsx`,
`components/portal/PortalConfirmation.jsx`,
`components/processes/AccessDelivery.jsx`, `pages/portal/PortalLoginPage.jsx`,
`pages/portal/PortalPasswordPage.jsx`, `pages/portal/PortalProcessPage.jsx`,
`utils/portalLabels.js`, `tests/portal/isolamento.test.js`.

**Frontend — alterados:** `routes/AppRoutes.jsx` (ramo `/portal` em `lazy()`),
`pages/clients/ClientFormPage.jsx` + `ClientPage.css` (bloco de acesso),
`pages/processes/ProcessDetailPage.jsx` + `ProcessPage.css` (entrega, selo,
histórico), `components/ui/StatusBadge.jsx` (3 estados de portal no mapa que já
existia), `pages/dashboard/DashboardHomePage.jsx` + `DashboardPage.css`
(sétimo cartão), `components/documents/GenerationPanel.jsx` +
`GenerationPanel.css` (aviso de visibilidade), `api/clientService.js`,
`api/processService.js`.

**Decisões**, com o porquê nos blocos acima: portal no mesmo app com instância
de HTTP, contexto e layout próprios; a tela nunca mais rígida que a API; a
confirmação depois do conteúdo; redefinir volta a provisória; o aviso de
visibilidade valendo para os dois caminhos de regeração.

**Dois achados que corrigiram premissas do próprio prompt:**

1. **A varredura de CSS pegou um defeito real.** As páginas do portal aplicavam
   classes cuja regra só chegava pela folha que o *layout* importa. O layout
   monta as páginas por `<Outlet/>` — dependência que só existe pela árvore de
   rotas não é alcançável por análise estática, e a varredura estava certa em
   acusar. Correção: cada página do portal importa `Portal.css`, não uma
   entrada de allowlist.
2. **A premissa da regeração não se reproduziu.** Ver a tabela dos dois
   caminhos, acima. Regerar documento visível e não editado **não** o tira do
   portal: o anterior continua ativo e visível, e o cliente segue vendo a
   versão antiga. O texto do aviso foi corrigido depois de medir contra a base
   do seed, com o servidor de pé.

**Reportado e NÃO implementado, por decisão de escopo:** a indicação de "há
confirmação nova" **na listagem** de processos. Nenhuma rota da 3.1 devolve
confirmação não vista por processo — `getSummary` devolve um escalar global
(`dashboardService.js:31,63`) e `listProcesses` anexa participantes só com
`{_id, clienteId, papel, principal}` (`processService.js:165-176`). Consultar
`/processes/:id/confirmacoes` por linha seria N+1. O contrato da 3.1 não se
muda nesta fase; a adição mínima que destravaria é um contador por processo na
listagem.

**Não tocado:** contrato das rotas da 3.1, `Fee`/`Installment`/`Payment`,
`documentRenderService.js`, catálogo de variáveis, envelope de `/auth`,
`axiosConfig.js`. **Nenhuma dependência nova em nenhum dos dois repositórios** —
`package.json` e `package-lock.json` idênticos a `main` nos dois.

---

### Fase 4.1 — Financeiro: DEC-027, DEC-028, ficha do processo e recibo

**Resumo:** o módulo mais antigo do projeto, o único nunca revisto, fecha. Três
dívidas registradas há fases saem juntas, `Fee.status` passa a ser derivado,
nasce a ficha financeira do processo e o recibo de pagamento em PDF. Backend
176 → 234 testes. **Frontend não tocado** — as telas são a Fase 4.2.

**Commits, um por parte, exceto a DEC-027 que é um só de propósito:**

| Commit | Parte |
|---|---|
| `dde2289` | DEC-027 — hook condicional + `save()` + `campo`, **commit único** |
| `d1f876d` | DEC-028 — status derivado das parcelas |
| `b54084d` | `valorPago` desnormalizado na parcela |
| `2a4fba3` | `PATCH` em fees, installments e payments |
| `0b14937` | `percentualHonorario` — catálogo 47 → 48 |
| `fe0760e` | ficha financeira do processo |
| `6bf572c` | extração do timbrado para módulo compartilhado |
| `307ba01` | recibo de pagamento em PDF |
| `ea6be25` | seed |
| `dc630d9` | suíte |

**Arquivos novos:** `services/letterheadService.js`, `services/receiptService.js`,
`services/financeiroService.js`, `tests/financial/honorario.test.js`,
`tests/financial/derivacao.test.js`, `tests/financial/ficha.test.js`,
`tests/financial/recibo.test.js`.

**Decisões**, todas com o porquê nos blocos acima: honorário sem parcela é
`pendente` e nunca `pago`; `percentualHonorario` formatado com vírgula decimal e
símbolo colado ("12,5%"); a ficha financeira **fora** do envelope de listagem; a
extração do timbrado **se sustentou** (texto extraído idêntico antes e depois); o
recibo **não é** `Document`; o portal continua **sem nada financeiro**.

**Duas premissas do roteiro que não se reproduziram**, reportadas e não
"corrigidas":

1. **O `feeService` não tem 409 de conflito de campo.** O roteiro pedia `campo`
   nos 409 dele; o `Fee` não tem índice único nenhum, e nenhum foi inventado. Os
   erros de campo do honorário são 400, e é neles que `campo` passou a sair — o
   `getApiErrorField` lê `data.campo` independente do status, então o helper
   saiu de inerte do mesmo jeito.
2. **`installmentService.js:229` não é um 409.** É o `throw` de 404 de
   `deletarInstallment`; o 409 de integridade está cinco linhas abaixo. Nada
   alterado por causa da referência errada.

**Um desvio deliberado do roteiro, com motivo:** o 409 de excedente **não**
passou a ler `Installment.valorPago`. O caminho de atualização precisa excluir o
próprio pagamento em edição do total, e um valor desnormalizado não sabe fazer
isso. O campo sustenta a ficha financeira; o 409 continua somando por consulta.

**Não tocado:** frontend, contrato das rotas do portal, envelope de `/auth`,
`PATCH /documents/:id/secoes/reordenar`, nenhum alias `PUT` removido.
**Nenhuma dependência nova** — `package.json` idêntico a `main`.

---

### Fase 4.3 — Indicadores do dashboard (DEC-028d) e a consistência com a ficha

**Resumo:** o resumo financeiro global ganha o recorte do mês, o valor do
vencido e os próximos vencimentos — e passa a **fechar com a soma das fichas**,
o que não acontecia. Backend 234 → 248 testes. Nenhum model, nenhuma rota nova,
nenhuma dependência.

**Arquivos alterados:** `services/dashboardService.js` (só
`getFinanceiroResumo`), `tests/isolation/tenant.test.js` (1 teste novo).
**Arquivo novo:** `tests/financial/resumo.test.js` (13 testes).

**Decisões**, com o porquê no contrato acima: a cadeia do resumo filtrada como
a da ficha; `pendente` como `contratado − recebido`; `recebidoNoMes` saindo de
`Payment`; fronteiras de mês em UTC; `getSummary` deixado intacto.

**Um achado que a fase mediu em vez de supor.** O roteiro pedia "se hoje não
bater, o resumo se ajusta à ficha". Não batia, e a divergência foi medida
contra o seed antes de qualquer alteração: 72.000/26.600 no resumo contra
71.200/25.800 nas fichas. `pendente` batia **por coincidência** — os dois erros
se cancelavam, o que é o pior formato possível para um defeito de soma.

**`proximosVencimentos` mudou o perfil de risco da rota.** Até a 4.2 o resumo
devolvia quatro escalares: um vazamento ali seria um total inflado, feio e
mudo. Agora a rota devolve **identidade** — id de parcela, id de processo,
número do processo e descrição do honorário. Por isso a varredura de isolamento
ganhou um teste dedicado a esse array, com contraprova positiva (uma parcela
futura de B, criada no próprio teste, porque as do arranjo comum vencem em
datas fixas de 2026 e já passaram).

**Não tocado:** frontend, models, `getSummary`, `getFeesByMonth`,
`financeiroService.js`, contrato da ficha, rotas do portal.
**`package.json` idêntico a `main`.**

---

### Fase 4.4 — Módulo de documentos: o gráfico sem cancelado (e nada mais)

**Resumo:** a fase foi de frontend. O backend entrou com **uma** alteração de
produção — `getFeesByMonth` deixa de somar honorário cancelado — e um arquivo
de teste. Backend 248 → 255.

**Por que o diff é mínimo, e isso é o resultado:** a fase começou com uma
auditoria do bug da folha de montagem e do contrato de edição pós-geração. Nos
dois casos o backend estava **correto e já testado**:

1. **A folha.** A sequência inteira da tela foi reproduzida por HTTP contra o
   servidor real — POST sem `ordem`, POST com `ordem`, PATCH reordenar, DELETE.
   Todos os passos responderam certo, com `secaoId` populado e `ordem` na
   sequência esperada. O defeito era o ciclo de vida de um efeito do React.
   **Nenhuma correção de contrato foi necessária.**
2. **O editor pós-geração.** O contrato da 2C já estava inteiro e coberto por
   `tests/documents/generation.test.js`: `PATCH /:id/texto` liga
   `editadoManualmente`; regerar sem `confirmarSobrescrita` responde 409; com
   ela responde 201, o anterior sai por soft delete com `substituidoPorId`, e o
   documento novo nasce `editadoManualmente: false`. O download de documento
   editado à mão traz o texto **editado**, em PDF e em DOCX, com o texto
   extraído do arquivo dentro do teste. **Faltava interface, não contrato.**

**Arquivos alterados:** `services/dashboardService.js` (só `getFeesByMonth`).
**Arquivo novo:** `tests/financial/graficoMensal.test.js` (7 testes).

**Não tocado:** `documentService.js`, `documentGenerationService.js`,
`documentRenderService.js`, `letterheadService.js`, models, contrato de rota
nenhum. **`package.json` idêntico a `main`.**

---

## Registro de sessões — original (2026-05)

### Sessão — 2026-05-06

**Resumo:** refatoração e padronização completa do backend.

**Arquivos criados:** `src/middleware/errorMiddleware.js`,
`src/middleware/notFoundMiddleware.js`

**Decisões tomadas:** soft delete universal via `ativo: false`; paginação
obrigatória em todos os `GET /`; controllers delegam 100% ao service; dois
repositórios GitHub separados.

**Commits:** `410657b`, `c5964ee`, `44769f1`, `d7d035e`, `5d4eecc`, `c0752ff`

---

### Sessão — 2026-05-09

**Resumo:** configuração da operação com Claude Code, resolução das duas
pendências técnicas restantes e rotação de credenciais.

**Decisões tomadas:** validação sempre no service, nunca no controller;
`CLAUDE.md` versionado junto com o código.

**Commits:** `3bedaf9`, `855aff4`

---

### Sessão — 2026-05-09 (segunda parte)

**Resumo:** estabilização do frontend — correção de todos os módulos para
compatibilidade com o backend.

**Decisões tomadas:** frontend lê `response.data.data ?? response.data` em
todas as listagens; `dataPagamento` só vai no payload quando
`status === "pago"`; payloads explícitos, sem spread de `formData`; populates
mínimos no backend, só onde há exibição.

**Commits:** `4f6a439`, `642f558`, `57ef774`, `5daa4bd`, `69e389e`, `4d5bf98`

---

### Sessão — 2026-05-12

**Resumo:** correção dos módulos de Pagamentos e Documentos no frontend.
Todos os módulos principais do frontend estabilizados.

**Decisões tomadas:** `listPayments` e `listDocuments` passam
`{ page, limit }` como query params; payloads explícitos em `PaymentFormPage`
e `DocumentFormPage`.

**Commits:** `10a0a5b`, `8f5eb1c`, `0b81ba3`
