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
- **`planoId` ≠ `reparcelamentoId`** (DEC-048): o primeiro é quem me criou, o
  segundo é quem me cancelou. Uma parcela pode ter os dois, diferentes.

---

## Convenção de fase — o relatório vira arquivo markdown (a partir da F-1b.3.1)

Ao final de **toda fase**, além de exibir o relatório no terminal, o relatório
**inteiro** é gravado em:

```
lexa_31maio/relatorios/AAAA-MM-DD-<fase>.md
```

Na F-1b.3.1: `lexa_31maio/relatorios/2026-08-20-F-1b.3.1.md`.

**Onde, e por quê.** `lexa_31maio/` é a pasta que **contém** os dois repos e
**não é repositório de nenhum deles**. O relatório fica **fora do controle de
versão**: não entra em commit por acidente, não polui histórico, não aparece em
`git status`. **Não se grava dentro do repo do backend nem do frontend.**

Regras do arquivo:

- É o relatório **completo**, com as **saídas reais coladas** — o mesmo
  conteúdo que iria para o terminal, **não um resumo dele**. Se algo foi
  truncado na exibição, o arquivo traz a versão inteira.
- Markdown de verdade: títulos por parte, tabelas onde há tabela, blocos de
  código para saídas de comando. **Vai ser lido fora do terminal, por outra
  pessoa.**
- Cabeçalho de identificação: nome da fase, data, **commits de merge dos dois
  repos**, contagem final das suítes, e uma linha de **veredito** — "concluída
  e mergeada" / "parcial, não mergeada" / "parada no portão X".
- **A regra de segredos vale igual aqui**: nenhum segredo no relatório, nem
  mascarado — prova por **definido/comprimento/comparação booleana**. Arquivo
  em disco é justamente onde essa disciplina costuma relaxar.
- No terminal, ao terminar, basta uma confirmação curta com **o caminho do
  arquivo gerado**.

A pasta é externa aos repos, mas **a regra é de processo** e por isso fica
registrada nos **dois** CLAUDE.md: ela precisa sobreviver a troca de sessão.


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
- ~~Não há `CLAUDE.md` no repositório do frontend.~~ **Existe desde a Fase
  4.2** (`lex-frontend/CLAUDE.md`, 791 linhas), e cobre as decisões de
  interface. Esta linha ficou desatualizada por quatro fases e foi corrigida
  na F-0. O contrato da API continua morando **aqui**; lá está o que é decisão
  de tela.

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
| `pendente` | nenhuma parcela ativa com pagamento **e o honorário sem pago líquido alocado** |
| `parcialmente_pago` | ao menos uma parcela paga, nem todas — **ou pago líquido alocado > 0** |
| `pago` | todas as parcelas ativas quitadas |
| `cancelado` | **apenas por escrita explícita** |

#### EMENDA DE 17/08/2026 (Fase F-1a.2, achado A-4)

> Registrada **dentro** da DEC-028, e não como decisão nova: é refinamento da
> mesma regra, e o histórico precisa mostrar isso.

**O que se via.** Na ficha da **"Ação de Cobrança de Dívida"**, o honorário
"Assessoria tributária — processo administrativo" exibia, na mesma linha:

> Recebido: **R$ 1.500,00**   ·   badge **"Pendente"**

Uma contradição no mesmo honorário, entre dois números que estavam certos cada
um por si.

**A causa.** Depois do reparcelamento (DEC-037), o dinheiro recebido vive nas
parcelas **canceladas COM vínculo**: a parcela 1, que era `parcial` com 1.500
alocados, é cancelada com esses 1.500 intactos — o dinheiro não volta, e o saldo
renegociado já o descontou. As parcelas novas nascem sem alocação. A derivação
filtrava as canceladas fora do conjunto, sobrava "tudo pendente", e ela dizia
`pendente` sobre um honorário que já recebera R$ 1.500,00.

A ficha, por outro lado, publica "Recebido" como `pagoLiquidoAlocado` — a soma
de `valorPago` de **todas** as parcelas, canceladas inclusive. **As duas
leituras saíam de fontes diferentes**, e por isso podiam divergir.

**A emenda.** Para distinguir `pendente` de `parcialmente_pago`,
`derivarStatusFee` passa a considerar o **pago líquido alocado do HONORÁRIO** —
a mesma grandeza que a ficha publica —, e não só o status das parcelas
vigentes. As duas leituras passam a concordar porque agora saem da mesma fonte.

**O que NÃO mudou, e é de propósito:**

| Regra | Estado |
|---|---|
| `cancelado` é o único status escrevível, e **nunca** é sobrescrito pelo recálculo | **intacta** — a guarda continua sendo o `return` próprio em `recalcularStatusFee`, acima da derivação, e não foi tocada |
| `pago` exige **em aberto zero** | **intacta** — só quando todas as parcelas VIGENTES estão `pago`. Dinheiro em parcela cancelada tira o honorário de `pendente`; **nunca** o promove a `pago` |
| honorário sem parcela nenhuma é `pendente`, nunca `pago` | **intacta** — sem parcela não há alocação, então o pago é zero |

**Onde está provado:** `tests/financial/derivacao.test.js`, seção 9 — um teste
para o caso do reparcelamento e **dois de regressão**, um para cada linha da
tabela acima. O invariante 3 de `tests/financial/invariantes.test.js` foi
atualizado junto, porque ele recomputava a fórmula antiga.

**Passo manual:** o **158** do roteiro, que olha o badge e o "Recebido" lado a
lado. A contradição é visual: nenhuma asserção de valor a pega, e foi assim que
o A-4 sobreviveu à suíte inteira da F-1a.

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



### DEC-020 — REVOGADA na Fase 4.5

`normalizarStatus`, em `installmentService.js`, derivava o status da parcela a
partir da data de vencimento. Foi declarada **intencional** no Bloco 11.

A linha do tempo, honesta:

| Quando | O quê |
|---|---|
| Bloco 11 | nasce e é declarada intencional |
| Fase 4.1 (DEC-028) | `definirStatusInstallment` (`paymentService.js`) passa a ser a única derivação, com `parcial` a mais e a conta feita sobre os **pagamentos ativos**, não sobre a data |
| Auditoria nº 2 | confirmada **sem nenhuma referência** |
| Fase 4.5 | **removida**; `git grep normalizarStatus` volta zero |

Não foi apagada por limpeza estética. Mantê-la deixaria duas derivações de
status da parcela no mesmo módulo, uma delas **errada** — não conhece `parcial`
e não olha pagamento nenhum — sem nada dizendo qual vale. É o formato de dívida
que a próxima pessoa resolve chamando a função errada.

### DEC-031 — cadastro aberto com 409 enumerável de e-mail. DECISÃO CONSCIENTE

Registrada na Fase 4.5. **Não é achado em aberto; é escolha, e fica escrita
para não ser "corrigida" por reflexo numa auditoria futura.**

`POST /auth/register` é público e responde **409 `E-mail já cadastrado`** com
`campo: "email"`. Isso permite enumerar quais e-mails têm conta no LEX.

**Por que fica como está:**

1. **O sistema é multi-tenant por design.** Qualquer pessoa pode criar a própria
   conta — é assim que os colegas do Daniel entram para testar, e é assim que a
   banca vai entrar na defesa. Não existe convite, não existe lista fechada:
   "este e-mail tem conta" não é segredo num sistema em que qualquer um pode
   criar a sua em dez segundos.
2. **A alternativa custa usabilidade real.** A anti-enumeração honesta é
   responder 201 genérico e mandar e-mail de confirmação — que exigiria provedor
   de e-mail, fila e uma tela de "confira sua caixa", tudo fora do escopo do TCC
   e sem nenhum ganho para a advogada. A alternativa preguiçosa (mensagem
   genérica "não foi possível cadastrar") deixa quem já tem conta sem entender
   por que o cadastro falhou.
3. **A escala não justifica.** O ganho teórico de anti-enumeração é proteger uma
   lista de usuários. A lista aqui tem UMA advogada real e algumas contas de
   teste.

**O que NÃO se aceita, e continua valendo:** o **login** não enumera. Os seis
casos de falha do portal devolvem corpo e status byte-idênticos (DEC-029, ponto
11), e o login da advogada não distingue "e-mail inexistente" de "senha errada".
Enumerar no cadastro é aceitável; enumerar no login diria quem tem conta E
serviria de oráculo para força bruta.

**Reabrir só se** o LEX deixar de ter cadastro aberto — aí a enumeração passa a
revelar uma lista que alguém escolheu fechar, e o cálculo muda.


### Allowlist de PATCH — contrato de TODAS as entidades (Fase 4.5)

`src/validations/shared/camposPermitidos.js` é a fonte única. Sete entidades:
`clients`, `processes`, `fees`, `installments`, `payments`, `secoes`,
`documents`.

**Duas regras, e as duas são mudança de contrato deliberada:**

1. **Campo desconhecido no corpo do PATCH → 400 com `campo`.** Antes era
   ignorado em silêncio em `clients`, `fees` e `processes`. Quem mandava um
   campo com nome errado recebia 200 e nenhuma alteração.
2. **`ativo` não pertence a allowlist nenhuma.** Desativar é papel do DELETE —
   que é onde vivem os 409 de integridade com `dependencia`/`quantidade`, e é
   justamente essa checagem que o corpo do PATCH pulava. Reativar é papel das
   rotas de reativação.

**O que a fase mediu antes de corrigir**, contra o seed, com o servidor de pé:

| Entidade | `PATCH {ativo:false}` antes | Efeito real |
|---|---|---|
| `clients` | 200 | desativado |
| `processes` | **404** | **desativado** |
| `fees` | 200 | desativado |
| `installments` | 200 | desativado |
| `payments` | 200 | desativado (`ativo` estava na allowlist **de propósito**) |
| `secoes` | 400 | bloqueado |
| `documents` | 400 | bloqueado |

**O caso do processo não estava no relatório da auditoria e é o pior dos sete.**
`updateProcess` grava por `findOneAndUpdate({ativo:true})` e relê por
`getProcessById`, que também filtra `ativo:true`. A escrita ACONTECIA e a
releitura não encontrava mais nada: a rota respondia **"Processo não
encontrado"** para uma requisição que acabara de desativar o processo.
Destruição relatada como erro de busca.

**Dois defeitos que só apareceram quando os testes foram escritos:**

- `PATCH /documents/:id {ativo:true}` respondia **200**. A guarda da Fase 2A
  testava `payload.ativo === false`; `true` era ignorado em silêncio. Documento
  era a única das sete que respondia conforme o VALOR do campo.
- Campo desconhecido em `/documents` dava 400 **sem `campo`**, porque
  `validateUpdateDocument` monta um `data` filtrado e o desconhecido era
  descartado antes de chegar ao service. A allowlist passou a rodar sobre o
  corpo **cru**, dentro da validação.

**`validateUpdatePayment` mudou de lugar**: do controller para o service.
Rodando antes do service, engolia a recusa da allowlist e devolvia "Informe ao
menos um campo válido", sem `campo`. Era também o único módulo financeiro fora
da convenção "validação sempre no service".

### Rotas de reativação (Fase 4.5)

| Rota | Guarda | Erro |
|---|---|---|
| `PATCH /api/payments/:id/reativar` | a **parcela** precisa estar ativa | 409 `dependencia: "parcela"` |
| `PATCH /api/installments/:id/reativar` | o **honorário** precisa estar ativo | 409 `dependencia: "honorario"` |

Sem corpo. As duas disparam a cadeia de recálculo até o honorário. Reativar
pagamento **reconfere o excedente**: enquanto ele estava fora, outros podem ter
ocupado o saldo da parcela.

**Cliente, processo, honorário e documento NÃO ganham reativação nesta fase** —
decisão de escopo. Os quatro têm cascata ou dependentes cujo comportamento na
volta precisa ser decidido, e inventar isso de passagem seria pior que a
ausência.

**A colisão de `numeroParcela` na reativação NÃO é alcançável.** O índice
`{feeId, numeroParcela}` é único **sem** `partialFilterExpression`
(`models/Installment.js:70`), diferente dos de `documento_secao`, que são
parciais em `ativo: true`. Sem filtro parcial, a parcela desativada nunca solta
o número — não existe segunda parcela para colidir na volta. A checagem fica
como rede, e há teste travando a premissa: se alguém tornar o índice parcial,
ele cai.

**`GET /payments?inativos=true` e `GET /installments?inativos=true`** listam
**só** os desativados. É um MODO, não um "incluir": misturar os conjuntos faria
a coluna de valor somar o que foi estornado sem nada dizendo isso na linha. O
default não muda. Existe para a tela poder oferecer "Reativar" — sem ele a
funcionalidade não teria porta de entrada.

### O que o service worker NUNCA cacheia (Fase 4.5)

O PWA é escrito à mão (`public/sw.js` no frontend), sem workbox e sem plugin.

**`/api/*` nunca entra em cache.** Toda resposta da API é autenticada e pertence
a UMA advogada: um cache dela é vazamento esperando o segundo usuário no mesmo
navegador — e o isolamento por `usuarioId` é a regra central do projeto. Além
disso, servir número financeiro velho de cache, sem nada dizendo que é velho,
faria a advogada planejar o mês com o dado do mês passado.

Também fora do cache: qualquer método que não seja `GET`, e qualquer origem que
não seja a do app.


### Classificação PF/PJ do catálogo e o vocabulário de `motivo` (Fase 4.6)

Cada chave de origem `cliente` carrega `tipoCliente`: `pf`, `pj` ou `comum`
(8 / 6 / 6). **A lista não foi escolhida a olho:** é exatamente o que o hook
`pre("validate")` de `models/Client.js` apaga em cada tipo.

**O caso que abriu a fase.** Um usuário real montou modelo com variáveis de PJ e
gerou para cliente PF. A pendência dizia *"Preencha 'CNPJ' no cadastro do
cliente"* — e seguir aquilo é **impossível**: o cadastro de um cliente PF não
tem CNPJ, e se tivesse o hook o apagaria na gravação. A orientação mandava a
pessoa a uma tela onde o campo não está.

`errors.pendencias[]` ganhou **`motivo`**, de vocabulário fechado
(`MOTIVO_PENDENCIA`), pelo mesmo motivo de `DEPENDENCIA` nos 409: sem lista, em
duas fases existiriam `tipoIncompativel`, `tipo_incompativel` e `incompativel`.

| `motivo` | Quando | Chaves que acompanham |
|---|---|---|
| `campoVazio` | o dado não foi preenchido | — |
| `tipoIncompativel` | variável de PF com cliente PJ (ou o contrário) | `tipoVariavel`, `tipoCliente`, `causa` |
| `tipoHonorarioIncompativel` | `{{percentualHonorario}}` em honorário fixo/custas | `tipoHonorario`, `causa` |
| `parcelasDesiguais` | `{{valorParcela}}` com parcelas de valores diferentes | `causa` |

**A tela separa os motivos**, e isso não é estética: incompatibilidade **não se
resolve preenchendo cadastro**. Listá-la junto de "faltam 3 dados" convidaria a
advogada a procurar um campo que não existe — que é o beco original com outra
roupa.

### O princípio: orientação EXECUTÁVEL, testada

Toda pendência responde três perguntas — o que falta, por quê, e onde/como
resolver — e **a ação sugerida é seguida até o 201 por um teste**
(`tests/documents/mensagens.test.js`, os blocos "ANTI-BECO").

Uma asserção de texto prova que a frase existe; não prova que segui-la leva a
algum lugar. As três mensagens antigas estavam gramaticalmente corretas e
mandavam a advogada a ações impossíveis:

| Antes | Por que era beco | Agora |
|---|---|---|
| *"Preencha 'CNPJ' no cadastro do cliente"* | cliente PF não tem CNPJ | diz a causa e manda vincular um cliente PJ **ou** usar outro modelo |
| *"Preencha 'Percentual do honorário' no honorário…"* | o hook do `Fee` responde **400** a isso | manda trocar o **tipo** para percentual, com `percentual` e `valorBase` |
| *"Preencha 'Valor da parcela' no honorário…"* | **esse campo não existe** | diz que as parcelas divergem e manda igualá-las |

Há teste que executa a orientação antiga do percentual e **exige o 400** — se
ela passar a funcionar, o beco deixou de existir e o teste avisa.

**`GET /api/documents/modelos/:id/compatibilidade?clienteId=`** (Fase 4.6):
leitura, responde 200 mesmo quando o resultado é "não serve", e devolve as
**seções** culpadas junto das variáveis — a advogada pensa em seções, não em
chaves. **Não bloqueia a geração**: o 422 é a rede, este é o alerta, e bloquear
impediria gerar um documento cujo trecho incompatível ela pretenda apagar no
texto final.

### Dois contratos alterados na Fase 4.6

1. **`422` de modelo sem seções ganhou `errors.pendencias[]`**, como todos os
   demais 422 do módulo. Era o único fora do formato, e obrigava o frontend a
   tratar dois formatos.
2. **`POST /api/fees` não exige mais `status`.** O schema já tem
   `default: "pendente"` e a DEC-028 deriva o valor das parcelas — exigi-lo era
   pedir ao cliente HTTP o único valor possível num honorário recém-criado.
   Enviado, continua **validado** contra o enum: mudou a obrigatoriedade, não a
   validação. Nenhuma requisição que funcionava antes deixou de funcionar.

**A sugestão de variável** (`{{nomeAdvogado}}` → *"você quis dizer
{{nomeAdvogada}}?"*) é distância de edição escrita à mão em `templateParser.js`,
com teto de 1/3 do nome. Sem teto, `{{xpto}}` sugeriria `{{sexoCliente}}` — e
sugestão errada com cara de certeza é pior que nenhuma. Sem candidata, a
mensagem aponta o **grupo** provável pelo sufixo. `{{nomeAdvogado}}` foi o nome
real da chave até a Fase 2D.2, que renomeou **sem alias**: quem cola texto de
anotação antiga cai exatamente nisto.

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

### Risco conhecido de dependência — REMEDIDO na Fase F-0

O bloco abaixo, escrito na Fase 2E.2, **descrevia um quadro que mudou**. A
auditoria de retomada rodou `npm audit` de novo e encontrou outra coisa; o
registro histórico fica preservado logo em seguida, porque ele explica por que
o `react-router-dom` está na versão em que está.

**Medido na F-0 (2026-08-17):**

| Repo | Total | Pacote | Cadeia | Sai no bundle? |
|---|---|---|---|---|
| Backend | **1 high** | `brace-expansion` | `nodemon → minimatch` | não — devDependency |
| Frontend | **3 high** | `brace-expansion`, `js-yaml` | `eslint` | não — devDependency |
| | | `nanoid` | `vite → postcss` | não — só build |

**As quatro são de cadeia de desenvolvimento. Nenhuma chega ao navegador da
advogada nem ao servidor em produção.**

**Duas afirmações do bloco de 2E.2 ficaram falsas:**

1. **O GHSA-qwww-vcr4-c8h2 do `react-router` não é mais reportado.**
   `react-router-dom@7.18.2` / `react-router@7.18.2` continuam instalados e o
   `npm audit` de hoje não os acusa. O risco residual que a 2E.2 aceitou por
   escrito **deixou de existir na base de advisories** — a decisão de manter a
   versão continua válida, mas não é mais uma decisão de risco.
2. **"As outras 5 exigem `eslint@10`, major"** — hoje as quatro restantes têm
   `fixAvailable` **sem major**. A F-0 **não as atualizou**: a fase autorizou
   apenas `mongoose` e `express-rate-limit`, nomeadamente, e subir a cadeia do
   `eslint` de passagem é o tipo de mudança que se faz na fase que a decidiu.
   Fica como item de backlog, não como risco aceito.

**Atualizado na F-0, dentro do semver:** `mongoose` 9.8.1 → **9.9.2**,
`express-rate-limit` 8.6.1 → **8.6.2**. Suíte verde nos dois casos.

**`bcryptjs` 2.4.3 → 3.x foi ADIADO, e é decisão consciente.** É major, e o
pacote fica no caminho de autenticação da advogada **e** do portal do cliente —
o lugar onde uma mudança de comportamento de hash não aparece em teste de
unidade e aparece no login de quem já tem senha gravada. Entra em fase que
tenha autenticação no escopo, com releitura do changelog e do formato de hash.

---

### Risco conhecido de dependência do frontend — o registro de 2E.2

Registrado na Fase 2E.2. Se alguém rodar `npm audit` na defesa, a resposta
precisa estar escrita. **Resposta honesta é melhor que otimista**, e por isso
o registro não é "15 → 7". **Ver o bloco acima para o quadro atual** — este
aqui ficou como histórico da decisão do `react-router`.

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
| `installments`     | 23   |  ← 20 + 3 nascidas do reparcelamento |
| `payments`         | 15   |  ← todos ativos: pagamento não se desativa (DEC-032) |
| `alocacoes`        | 17   |  ← 15 ativas + 2 desfeitas por estorno |
| `estornos`         | 2    |  ← 1 total e 1 parcial |
| `reparcelamentos`  | 1    |  ← 2 parcelas canceladas COM vínculo |
| `documents`        | 19   |
| `secoes`           | 11   |
| `documento_secao`  | 41   |
| `confirmacoes_visualizacao` | 2 |

**Estados financeiros do seed (atualizado na F-1a):** os quatro derivados
continuam presentes — `cancelado` 1, `pago` 3, `parcialmente_pago` 5,
`pendente` 3.

**Os cinco casos do Financeiro 2.0 que o seed exercita**, todos pelos services
de verdade (nada é escrito à mão no banco, então um seed que roda até o fim é
teste de fumaça do módulo inteiro):

| Caso | Onde |
|---|---|
| pagamento que atravessa **duas parcelas** | divórcio litigioso — PIX de 4.500 |
| **estorno total** com desalocação | fase inicial — boleto devolvido |
| **estorno parcial** com desalocação | usucapião — contestação do cartão |
| **adiantamento** com auto-alocação posterior | inventário — 5.000 antes das parcelas |
| **sobra** virando saldo adiantado | recurso administrativo — 3.500 sobre 3.000 |
| **reparcelamento** com parcelas canceladas-com-vínculo | assessoria tributária — 2 viram 3 | O
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


### Fase 4.5 — Correções da Auditoria Geral nº 2

**Resumo:** o contorno do `ativo` fechado nas sete entidades, reativação
explícita, guardas de tipo nos filtros, preparo de produção, PWA à mão e a
cobertura que faltava. Backend 255 → **311**. Frontend 213 → **240**.

**A fase saiu em DUAS sessões, e a divisão está no histórico:** a primeira
implementou as Partes 1, 2, 5.3, 5.4 e 6 e **parou corretamente** ao descobrir
que a suíte do backend não rodava (`lex_test` com bad auth no Atlas) — escrever
trinta testes sobre cinco services financeiros sem poder executá-los, e mergear
isso, seria o oposto do que este projeto faz. A segunda sessão retomou com a
senha corrigida, escreveu os testes e completou o resto.

**Arquivos novos (backend):** `validations/shared/camposPermitidos.js`,
`utils/filtrosDeConsulta.js`, `tests/integrity/allowlist.test.js`,
`tests/integrity/reativacao.test.js`, `tests/infra/filtros.test.js`,
`tests/infra/producao.test.js`, `tests/financial/invariantes.test.js`,
`tests/financial/percentualVetores.test.js`, `tests/auth/perfil.test.js`,
`tests/fixtures/percentualVetores.json`.

**Arquivos novos (frontend):** `public/manifest.webmanifest`, `public/sw.js`,
`public/icone-192.png`, `public/icone-512.png`, `src/registrarSW.js`,
`tests/css/foco.test.js`, `tests/pwa/pwa.test.js`,
`tests/financial/percentualVetores.test.js`, `tests/fixtures/percentualVetores.json`.

**Decisões**, com o porquê nos blocos acima: allowlist como contrato único;
`ativo` fora de todo corpo de PATCH; reativação em rota própria com guarda; o
recálculo do honorário deixando de exigir parcela ativa; guardas de tipo que
não dependem do default do `query parser`; `trust proxy: 1` e não `true`; HSTS
só em produção; o SW sem `/api/*`; DEC-031 registrada; DEC-020 revogada.

**Quatro premissas do roteiro que NÃO se reproduziram**, reportadas e não
forçadas:

1. **Não havia injeção de operador ativa.** Medido: `?tipo[$ne]=clausula`
   devolvia o total INTEIRO, não o filtrado — o Express 5 usa o query parser
   `simple`, que entrega `tipo[$ne]` como chave literal. A guarda entrou porque
   a proteção era do framework, não do código: uma linha de configuração
   transformaria os quatro filtros em injeção de uma vez, sem nenhum teste cair.
2. **A colisão de `numeroParcela` na reativação é inalcançável** — índice único
   sem `partialFilterExpression`. Ver o bloco das rotas de reativação.
3. **O item 5.5 (datas dos testes em fuso local) não existe.**
   `resumo.test.js` e `graficoMensal.test.js` já derivavam o mês com
   `getUTCFullYear`/`getUTCMonth`. Varredura por getters locais nos dois
   arquivos: nenhum. **Descartado, nada implementado.**
4. **O 2.5b não é mais alcançável pela API** depois da Parte 1.1: `PATCH
   {ativo:false}` morreu, `deletarInstallment` já recusava com 409 havendo
   pagamento ativo, e reativar pagamento exige parcela ativa. A correção
   permanece como defesa em profundidade e como reparo de base já corrompida —
   e o teste monta o estado por escrita direta, com o motivo escrito.

**Um erro meu, pego pela asserção de guarda do próprio teste:** o teste da ordem
do arredondamento usava `33.33% de 1000`, e `1000 * 33.33` dá exatamente 33330
em ponto flutuante — as duas ordens coincidiam e o teste não provava nada. O
`assert.notEqual` que existia justamente para isso reprovou o par, e o caso
passou a ser `8.75% de 987654.32`, em que a ordem realmente aparece.

**Não tocado:** `documentRenderService.js`, `letterheadService.js`, catálogo de
variáveis, contrato das rotas do portal, envelope de `/auth`.
**Nenhuma dependência nova** — `package.json` idêntico a `main` nos dois repos.
Os ícones do PWA foram gerados por script descartável com o PIL do ambiente.

---


### Fase 4.6 — Mensagens que orientam

**Resumo:** o conflito PF/PJ passa a dizer a verdade, e os sete becos sem saída
da lista 5.2 do Raio-X são fechados um a um — cada orientação nova com um teste
que a SEGUE até o 201. Backend 311 → **327**. Frontend 240 → **250**.

**Arquivos novos (backend):** `tests/documents/mensagens.test.js`.
**Arquivos novos (frontend):** `components/documents/PendenciaList.jsx` + `.css`,
`tests/documents/mensagens.test.js`.

**Alterados (backend):** `config/templateVariables.js` (classificação `pf`/`pj`/
`comum`, `MOTIVO_PENDENCIA`, `caminhoDoCampo`, orientação reescrita),
`services/documentGenerationService.js` (`detalharPendencia`,
`compatibilidadeService`, `parcelasDesiguais` na origem do honorário),
`utils/templateParser.js` (distância de edição), `validations/secaoValidation.js`,
`validations/feeValidation.js`, `controllers/documentController.js`,
`routes/documentRoutes.js`, `tests/documents/generation.test.js` (duas asserções
de texto atualizadas — a mudança de mensagem é o produto da fase).

**Decisões**, com o porquê nos blocos acima: a classificação sai do hook do
`Client` e não de julgamento; `motivo` em vocabulário fechado; a tela separa
incompatibilidade de campo vazio; o aviso preventivo avisa e **não** bloqueia; a
lista de pendências vira componente único para as duas telas.

**O pior beco não estava na mensagem, e sim no descarte dela.**
`DocumentFinalTextPage` tratava o 422 com `toast.error(message)` — e o `message`
do backend é "há informações faltando no cadastro", que **não nomeia nada**. O
comentário no código afirmava que "a mensagem do backend já nomeia o que falta".
Não nomeia: os nomes vivem em `errors.pendencias[]`, que aquela tela jogava
fora. A advogada clicava em Regerar e não tinha como descobrir o que faltava.

**Não tocado:** o motor de resolução (nenhuma mudança de semântica —
`substituir`, `montarValores` e a ordem das pendências continuam idênticos),
`documentRenderService.js`, `letterheadService.js`, rotas do portal.
**Nenhuma dependência nova.**

---

---

## Financeiro 2.0 — DEC-032 a DEC-039 (Fase F-1a)

> O módulo financeiro foi reescrito sobre um modelo novo. As oito decisões
> abaixo nasceram nos cabeçalhos dos arquivos da fundação (commit `2c639ee`) e
> estão transcritas aqui por extenso — até esta fase o raciocínio existia só no
> código, e um `CLAUDE.md` que não o carrega deixa a próxima sessão reabrindo
> discussão fechada.
>
> **A Fase F-1 foi DIVIDIDA em três.** Ver o bloco "A divisão F-1a/b/c", no fim.

### DEC-032 — o pagamento é IMUTÁVEL

`Payment` deixou de ter `installmentId` e deixou de ser editável.

| Antes (até F-0) | Agora |
|---|---|
| `installmentId` obrigatório | `honorarioId` — o vínculo com parcelas virou `Allocation` |
| `valorPago`, `dataPagamento` | `valor`, `data` |
| PATCH de 5 campos | PATCH de **um**: `observacoes` |
| `DELETE /payments/:id` | **não existe** — estornar é o caminho |
| `PATCH /payments/:id/reativar` | **não existe** (ver DEC-034) |

**Um registro de dinheiro que muda de valor não é registro, é rascunho.** A
advogada precisa poder responder, meses depois, "quanto entrou, quando, e por
que parte disso voltou" — e um PATCH que reescreve o valor apaga exatamente
essa pergunta, sem deixar rastro de que houve correção.

`observacoes` fica porque é **anotação sobre o fato, não o fato**.

**`ativo` continua no schema e nenhuma rota o escreve.** O soft delete
universal é regra central do projeto e a coleção mantém o campo por
uniformidade de leitura. O que mudou é que não há caminho para gravá-lo.

**Não houve migração**: não existe base de produção, e o seed é a única
população. O modelo antigo morreu inteiro.

**`formaPagamento` foi PRESERVADO** contra a lista de campos do roteiro
original da F-1. A advogada registra por onde o dinheiro entrou, a listagem
filtra por isso e o recibo imprime. Tirar o campo seria perder informação real
para encurtar um contrato.

### DEC-033 — estorno, e por que ele não é um campo

Coleção `estornos` (`models/Reversal.js`). Corrigir dinheiro gravado deixou de
ser edição e passou a ser um **registro novo que aponta para o anterior**.

**Imutável de verdade: sem PATCH e sem DELETE.** Um estorno errado se desfaz
com OUTRO estorno, do tipo `anulacao`, apontando o anulado por
`estornoAnuladoId`. Três fatos, três registros, nenhuma reescrita.

**`ativo` NÃO existe neste model, e a ausência é deliberada.** Em todo o resto
do projeto `ativo: false` significa "excluído"; aqui, "estorno que não vale
mais" é o que a anulação descreve. Ter os dois mecanismos daria duas maneiras
de anular a mesma coisa, e um relatório que somasse por um deles ficaria errado
sem ninguém notar.

**"Estorno ativo" é resposta de CONSULTA, não campo gravado**
(`reversalService.mapaDeAnulacoes`). Campo desnormalizado com duas fontes de
escrita é campo que diverge — a mesma razão pela qual `Installment.valorPago`
tem ponto único de escrita.

**Um estorno só pode ser anulado UMA vez**, garantido por índice único parcial
em `estornoAnuladoId`. A checagem no service é a mensagem amigável (409 que
orienta); o índice é o que segura numa corrida entre duas requisições.

**A anulação re-aloca pela regra normal**, e não repõe o dinheiro exatamente
nas parcelas de onde ele saiu: entre o estorno e a anulação o mundo pode ter
mudado — uma parcela pode ter sido reparcelada, outra quitada por outro
pagamento. Repor no estado antigo criaria alocação em parcela cancelada.

| Situação | Resposta |
|---|---|
| estorno acima do líquido | **422**, `errors.estornavel` diz o teto |
| pagamento já estornado por inteiro | **422**, `errors.estornavel: 0` |
| anular estorno já anulado | **409** `estornoJaAnulado` |
| anular uma anulação | **409** `anulacaoDeAnulacao` |
| anular estorno de outro pagamento | **409** `estornoInexistente` |

### DEC-034 — as duas rotas de reativação MORRERAM

`PATCH /api/payments/:id/reativar` e `PATCH /api/installments/:id/reativar`,
criadas na Fase 4.5, respondem **404**.

As duas existiam para desfazer um soft delete. Com o Financeiro 2.0:

- **pagamento** não se desativa — ele se estorna (DEC-033), e o estorno se
  desfaz por anulação. Os dois registram um fato novo em vez de reescrever o
  antigo; uma rota que devolvesse o pagamento ao ar apagaria o motivo pelo qual
  ele saiu;
- **parcela** que sai de circulação por decisão da advogada sai por
  reparcelamento (DEC-037), cancelada COM `reparcelamentoId`. "Reativar" uma
  dessas ressuscitaria uma cobrança que foi substituída, ao lado da que a
  substituiu: as duas somariam, e a advogada cobraria duas vezes.

**`ativo` continua fora de toda allowlist de PATCH** (Fase 4.5), e isso ficou
MAIS importante e não menos: é agora a única coisa entre a advogada e um
registro financeiro desativado em silêncio por um campo de formulário.

`tests/integrity/reativacao.test.js` foi **reescrito, não apagado** — trava os
404, os caminhos que tomaram o lugar das rotas, e as duas premissas estruturais
que ele já protegia.

### DEC-035 — o motor de alocação

Um pagamento não pertence a uma parcela: ele gera `Allocation`s. Um PIX que
cobre duas parcelas passa a ser **um** pagamento com **duas** alocações, em vez
de dois pagamentos e dois recibos.

**As duas ordens, e por que são opostas:**

- **alocar: do vencimento mais ANTIGO para o mais novo.** É o que qualquer
  pessoa faz com uma dívida — paga o que está vencido primeiro. Alocar no mais
  novo deixaria a parcela vencida em aberto com dinheiro no caixa, e a listagem
  mostraria "vencida" para quem acabou de pagar;
- **desalocar: do mais NOVO para o mais antigo.** Espelhada, e não igual. Um
  estorno desfaz o efeito do pagamento na ordem inversa em que ele aconteceu.
  Desalocar do mais antigo faria uma parcela antiga voltar a dever enquanto uma
  nova continuasse quitada pelo mesmo dinheiro estornado — estado que nenhuma
  leitura humana explica.

**Três decisões INTOCÁVEIS, registradas na fundação:**

1. **Alocação negativa é proibida.** Desalocar carimba `estornoId` na linha; não
   existe `Allocation` de valor negativo. Uma linha negativa somaria certo e
   leria errado — e nenhum extrato explicaria "alocação de −R$ 300".
2. **Estorno parcial SUBSTITUI a linha da alocação.** A original é carimbada e
   uma linha nova, com o resto, toma o lugar dela. A alternativa descartada era
   reduzir `valor` na linha existente: seria uma linha a menos e uma mentira —
   o registro passaria a dizer que sempre alocou o valor menor, e o extrato
   perderia a informação de que houve alocação maior antes.
3. **Preview e criação usam a MESMA função de planejamento**
   (`planejarAlocacao`, pura). É isso que impede o preview de mentir: se ele
   mostrar algo diferente do que o POST faz, é porque alguém escreveu a regra
   duas vezes — e aqui não há como.

**O 409 `pagamentoExcedeParcela` foi REVOGADO.** Ele recusava um fato: o cliente
depositou 3.500 numa cobrança de 3.000, e o sistema mandava a advogada registrar
outra coisa — o depósito real não existia em lugar nenhum. O valor agora
atravessa as parcelas seguintes e o resto vira saldo (DEC-036). O valor saiu do
vocabulário fechado `REGRA_CONFLITO`: lista fechada com entrada morta é como
alguém volta a emitir a regra achando que ela vale.

**Toda conta passa por `emCentavos`.** Somar float em cima de float acumula
resíduo, e resíduo aqui é a advogada lendo "em aberto: R$ 0,00000000001" ou,
pior, uma parcela que nunca fecha porque falta 1e-13.

### DEC-036 — `saldoAdiantado`, para que nada se perca

`Fee.saldoAdiantado` guarda dinheiro recebido que ainda não achou parcela.
Alimentado por pagamento sem parcelas em aberto e pela SOBRA de um pagamento
que cobriu tudo. Consumido automaticamente quando parcelas novas nascem, do
primeiro vencimento em diante, virando `Allocation`s de origem `saldoAdiantado`.

Sem ele, o troco de um pagamento maior teria de ser **recusado** (e a advogada
registraria um valor que não foi o que entrou) ou **descartado em silêncio**
(pior). Com ele, o dinheiro fica visível no extrato até encontrar destino.

**As alocações de saldo nascem sem pagamento novo**, com `origem:
"saldoAdiantado"`: o dinheiro já tinha entrado, e o extrato precisa distinguir
"entrou hoje" de "encontrou destino hoje". Sem essa distinção, o cartão
"recebido no mês" contaria duas vezes o mesmo real.

**A auto-alocação dispara quando a parcela NASCE** — criação avulsa, criação em
lote e reparcelamento. Sem isso, a advogada registraria um adiantamento,
emitiria as parcelas e veria todas em aberto com o dinheiro parado no saldo, e
"resolveria" lançando o pagamento de novo — criando um recebimento que nunca
existiu.

**`tipo` do pagamento (`comum` / `adiantamento`) é DESCRITIVO, não um segundo
motor.** Ver "Decisões tomadas por conta própria" — este ponto foi alterado em
relação à fundação nesta fase.

### DEC-037 — reparcelamento com VÍNCULO

`POST /api/fees/:id/renegotiations`. Coleção `reparcelamentos`.

Renegociar **não apaga** as parcelas antigas: as que estavam em aberto ganham
`status: "cancelado"` **e** `reparcelamentoId` apontando para o registro. O
histórico conta a história — "estas cinco viraram aquelas três, nesta data, por
este motivo" — e some inteiro se as antigas forem deletadas. É a mesma tese da
confirmação de visualização da DEC-029: **prova que some não serve para nada**.

**A soma das parcelas novas tem de igualar EXATAMENTE o saldo em aberto.**
Aceitar soma diferente seria aceitar que a operação mude o valor devido sem
dizer. Renegociar prazo é uma coisa; dar desconto é outra, tem nome, tem
consequência contábil e precisa de decisão explícita — não pode acontecer como
efeito colateral de uma conta que não fechou. O **422** devolve
`errors.saldoEsperado` e `errors.somaInformada` justamente para ela ver os dois
números e decidir.

**Parcelas PAGAS ficam intactas** — não entram no cancelamento, no snapshot nem
na conta. O dinheiro já foi recebido e a cobrança correspondente foi cumprida;
cancelá-las apagaria a quitação. As **PARCIAIS** são canceladas com vínculo, e o
que já foi alocado nelas fica onde está, como histórico: só o que faltava entra
no saldo renegociado.

**O snapshot `parcelasCanceladas` não é redundância.** A parcela continua
existindo e legível, mas o `valorPago` dela pode mudar depois (um estorno
desaloca), e a leitura "quanto estava em aberto quando renegociamos" deixaria
de ser recuperável. O snapshot congela o que a conta usou.

**A numeração das parcelas novas CONTINUA a sequência**, não recomeça em 1: o
índice `{feeId, numeroParcela}` não é parcial (Fase 4.5), então a parcela
cancelada nunca solta o número, e recomeçar colidiria na primeira.

### DEC-038 — `historicoStatus` append-only, com ORIGEM

`Fee.historicoStatus` registra cada transição de status. **Ponto único de
escrita: `services/statusHistory.js`.**

Um array append-only cuja escrita estivesse espalhada por três services
registraria as transições que alguém lembrou de registrar, e a advogada leria os
buracos como "não mudou". **Pior que histórico nenhum: um incompleto parece
completo.**

**Por que uma função, e não um hook `pre("save")`:** o hook não sabe a ORIGEM.
Ele enxerga que `status` mudou de `pendente` para `pago`, mas não se foi
recálculo, cancelamento explícito ou reparcelamento — que é justamente a
informação que distingue "o sistema derivou" de "alguém decidiu".

| `origem` | Quando |
|---|---|
| `criacao` | a linha de nascimento (`de: null`) |
| `recalculo` | derivação normal da DEC-028 |
| `cancelamento` | escrita explícita de/para `cancelado` |
| `reparcelamento` | o plano foi refeito |

**A origem VIAJA pela cadeia de recálculo** (`recalcularParcelas` →
`recalcularStatusInstallment` → `recalcularStatusFee`). Carimbá-la depois não
funciona, e a primeira versão desta fase tentou: quando o bloco explícito
rodava, o recálculo já tinha gravado a transição como `recalculo` e
`registrarStatus` devolvia `false` por status igual. O teste do invariante 9
pegou.

**Status igual não vira linha**: um recálculo que confirma `pendente` mil vezes
encheria o array de ruído e enterraria as mudanças reais.

**`feeService` não escreve `status` por `Object.assign`.** O campo é retirado do
payload e passa pelo ponto único — senão o histórico nasceria com buracos
exatamente no cancelamento, que é a transição mais importante.

### DEC-039 — `config/tiposHonorario.js`. **PROVISÓRIA**

O vocabulário de tipo de honorário saiu de `models/Fee.js` para arquivo
próprio, com valor gravado e rótulo de exibição separados, para que ratificar a
lista com a advogada vire acrescentar uma linha lá. O `Fee` reexporta, porque é
de lá que meio projeto importa desde a Fase 1 — trocar todos os imports de uma
vez seria churn sem ganho.

**A decisão é PROVISÓRIA e aguarda ratificação da Laís.** É vocabulário
jurídico da prática dela, não decisão técnica, e esta fase **não acrescentou
nem tirou nenhum valor**: continuam `fixo`, `percentual`, `custas`.

As perguntas em aberto são as mesmas registradas desde a Fase 4.6: "custas" é
despesa processual e pode não pertencer a este enum; "êxito" e "sucumbência"
podem ser tipos que faltam. **Nada disso se decide sem ela.**

O que a fase FEZ foi tirar a segunda lista de rótulos do projeto — havia um mapa
local em `Fee.js` ao lado do enum, e duas listas para a mesma pergunta divergem.

---

### O contrato das rotas novas (F-1a)

| Verbo | Caminho | Nota |
|---|---|---|
| POST | `/api/payments` | nasce contra `honorarioId`; devolve `{ pagamento, alocacoes, sobra, saldoAdiantado }` |
| POST | `/api/payments/preview` | o que ACONTECERIA; não grava nada |
| POST | `/api/payments/:id/reversals` | estorno e anulação (`estornoAnuladoId`) |
| GET | `/api/payments/:id/reversals` | os estornos do pagamento, com `anulado` |
| GET | `/api/fees/:id/statement` | **extrato** — linha do tempo mesclada, paginada |
| POST | `/api/fees/:id/renegotiations` | reparcelamento |
| GET | `/api/fees/:id/renegotiations` | os reparcelamentos do honorário |
| GET | `/api/financeiro/processos/:id/payments` | pagamentos do processo, paginados |

**O extrato é agregado por LEITURA. Nenhuma coleção de log nova.** Cada evento é
derivado de um registro que já existe e já é imutável — `Payment`, `Reversal`,
`Allocation`, `Renegotiation` e o `historicoStatus` do `Fee`. Uma coleção de
eventos separada seria uma SEGUNDA fonte da verdade sobre os mesmos fatos, livre
para divergir no dia em que alguém gravasse num lugar e esquecesse do outro — e
um extrato que discorda da ficha é pior que extrato nenhum, porque parece
autoridade.

O extrato **usa** o envelope de listagem (`data`/`total`/`page`/`limit`/
`totalPages`), diferente da ficha financeira: ali há uma listagem de verdade.
Ordenação por data e, em empate, por `id` — sem o segundo critério a paginação
repetiria e pularia linhas.

### A invariante da ficha e o contrato do resumo mudaram

```
contratado − pagoLiquidoAlocado − saldoAdiantado = emAberto
```

Os dois termos abatem o em aberto porque os dois são dinheiro no caixa da
advogada; o que os separa é só ter ou não uma parcela apontada. Contar só o
alocado faria um honorário integralmente adiantado aparecer como devendo tudo,
no dia seguinte ao cliente ter pago.

`emAberto` sai da FÓRMULA, e não de uma segunda soma sobre as parcelas — mesma
razão pela qual `pendente` do resumo é `contratado − recebido` desde a 4.3. Pode
dar **negativo**, e é honesto: um honorário que recebeu mais do que foi
contratado tem crédito, e zerar no piso esconderia dinheiro da cliente.

**DUAS mudanças de contrato em `GET /financeiro/resumo`:**

1. **`pendente` passa a ser `contratado − recebido − saldoAdiantado`.** Sem o
   terceiro termo ele divergiria da soma das fichas no primeiro adiantamento — a
   mesma divergência que a Fase 4.3 existiu para fechar, e que
   `tests/financial/resumo.test.js` trava somando as fichas de verdade.
2. **`saldoAdiantado` é chave NOVA de primeiro nível.** São dez agora.

**`recebidoNoMes` continua saindo de `Payment`** e passa a ser **líquido dos
estornos do próprio pagamento**. Um pagamento de 1.000 em agosto, estornado em
300, contribui com 700 — mesmo que o estorno seja de setembro: o abatimento
segue o PAGAMENTO, que é a coisa datada de agosto. Contar o bruto faria a
advogada fechar o mês com dinheiro que devolveu; datar o abatimento pelo estorno
faria agosto mudar de valor conforme setembro, e um mês fechado não pode se
mexer.

**A ficha trocou `parcela.pagamentos` por `parcela.alocacoes`.** O nome mudou
porque a coisa mudou: não são os pagamentos da parcela, são os pedaços de
pagamento que encostaram nela — e um mesmo pagamento pode aparecer em duas.
Cada alocação traz `pagamentoId`, que é o vínculo que a tela navega.

**O recibo é do valor LÍQUIDO**, e some (404) quando o líquido zera. "Recebi de
fulano a importância de X" precisa ser verdade no dia em que o papel é lido;
imprimir o bruto daria ao cliente um comprovante de um valor que ele não pagou —
justamente o documento que ele guardaria para provar o contrário. Um pagamento
que cobre duas parcelas as nomeia ("parcelas 1 e 2 de 3").

### DEC-040 — em aberto tem PISO ZERO; crédito é campo próprio (F-1a.1)

**Substitui a decisão nº 4 da F-1a** ("`emAberto` pode ficar negativo, e é
honesto"), preservando a preocupação dela — não esconder dinheiro da cliente —
com execução correta.

#### O caso que a derrubou, em números

Smoke test manual de 17/08/2026, na main mergeada:

| | |
|---|---|
| contratado do processo | **10.500** |
| recebido | **7.500** |
| em aberto EXIBIDO | **2.500** |
| em aberto REAL | **3.000** |

Um honorário com **−500** de crédito abatia a dívida de outro na soma do
processo. O dinheiro fechava — nada sumia —, mas a leitura mentia, e mentia **a
favor do cliente**, num módulo que imprime recibo assinado.

#### A regra

```
emAberto (parcela)   = max(0, valor − valorPago)
emAberto (honorário) = max(0, contratado − pagoLiquidoAlocado)
emAberto (processo)  = Σ emAberto dos honorários NÃO CANCELADOS
saldoAdiantado       = crédito, sempre NOMEADO, nunca somado nem subtraído
```

- **`saldoAdiantado` não entra em conta nenhuma.** Não é recebido (não quitou
  obrigação) e não abate em aberto (é crédito, não pagamento). Ele existe no
  model como sempre e passa a ser exibido ao lado, com nome.
- **A soma do processo é Σ DAS LINHAS**, e não uma fórmula própria. Recalcular
  por `contratado − pago` reintroduziria o defeito: a subtração global não
  conhece a fronteira entre honorários. **Crédito é do honorário onde foi
  gerado.**
- **`contratado − pagoLiquidoAlocado − saldoAdiantado = emAberto` DEIXA DE SER
  a invariante da ficha.** Era a fórmula que produzia o negativo.

#### O que mudou junto, e por quê

`renegotiationService.saldoEmAberto` usava a mesma fórmula antiga. Enquanto ela
subtraía o crédito, o reparcelamento exigia um plano **menor** que a dívida — e
logo depois a auto-alocação (DEC-036) consumia o crédito dentro desse plano
menor, descontando **o mesmo dinheiro duas vezes**.

Medido: honorário de 7.500 com 1.500 alocados e 500 de crédito. Pela fórmula
antiga o plano novo somava 5.500, a auto-alocação punha os 500 nele, e as
parcelas novas ficavam com 5.000 em aberto — enquanto o honorário dizia 5.500.
Os dois níveis discordavam em exatamente o valor do crédito. Com a fórmula nova
os dois dizem 5.500.

`pendente` do resumo passou a somar **por honorário**, com piso, em vez de
subtrair globalmente. Continua fechando com a soma das fichas — a igualdade que
a Fase 4.3 existiu para garantir.

#### O piso da PARCELA é alcançável, não é defesa em profundidade

O motor nunca aloca mais do que a parcela comporta. Mas
`PATCH /installments/:id { valor }` aceita **reduzir** o valor da parcela
depois de ela ter recebido alocação, e `valorPago` é recalculado das alocações,
não do valor da parcela. Sem o piso, a parcela exibiria "em aberto −R$ 500,00"
e o número entraria em `aReceberNoMes` e `valorVencido`, abatendo outras
parcelas. Há teste que percorre esse caminho pela API.

**O excedente não some por causa do piso:** ele continua visível em
`valorPago`, que fica maior que `valor` — e é ali que a advogada vê que recebeu
mais do que cobrou.

#### Uma premissa do roteiro desta fase que NÃO se confirmou

O roteiro dizia que "`valorVencido` e o em aberto usam a mesma fórmula e
carregam o mesmo defeito". **Carregam metade dele.** `aReceberNoMes` e
`valorVencido` somam o em aberto de PARCELA, que nunca subtraiu
`saldoAdiantado` — o defeito do crédito não passava por ali. O que passava era
o negativo por `valor` reduzido, e é esse que o piso fecha. Corrigido e
provado; a caracterização é que estava mais larga do que o defeito.

#### O invariante 6 era CIRCULAR, e é por isso que ele passou verde

Ele recomputava `contratado − pagoLiquidoAlocado − saldoAdiantado` a partir dos
**mesmos campos** que a API devolvia, e comparava com o `emAberto` que a API
calculara com a **mesma fórmula**. Uma tautologia: só falharia se o backend se
contradissesse consigo mesmo, nunca se a fórmula estivesse errada.

Reescrito com verificação independente — a expectativa sai dos dados **brutos**
das parcelas (`valor` e `valorPago`, que não derivam da fórmula sob teste), e o
que se afirma é a REGRA (nunca negativo; crédito fora da conta), não a
aritmética. Casos novos: crédito + dívida no mesmo processo (o caso observado),
crédito maior que o contratado, crédito em honorário cancelado, e parcela com
valor reduzido abaixo do alocado.

**A igualdade `emAberto do honorário = Σ emAberto das parcelas ativas` só é
exigida onde ela vale**: quando o honorário está integralmente parcelado. Um
honorário de 3.000 com uma parcela de 1.000 emitida deve 3.000 na ficha e 1.000
pela soma das parcelas — decisão publicada desde a Fase 4.3, e a que vale é a
da ficha. Exigi-la sempre transformaria uma decisão registrada em bug.

---

### DEC-041 — o recibo DESCREVE a alocação. **PROVISÓRIA** (F-1a.1)

#### O caso que a originou

Recibo emitido de um pagamento de **R$ 7.000,00** dizia:

> referente a Honorários advocatícios — **parcela 2 de 2**
> […] dando **plena e geral quitação** do valor acima em relação à obrigação a
> que se refere.

Quando só **R$ 1.500,00** foram para aquela parcela (que vale 3.000) e
**R$ 5.500,00** viraram crédito. O documento é assinado pela advogada e
entregue ao cliente: ele **quitava mais do que a obrigação a que se referia**, e
é o papel que o cliente guardaria para provar isso.

#### As duas regras

1. **O recibo é DO PAGAMENTO.** Uma alocação não gera recibo próprio — um PIX é
   um recibo, mesmo cobrindo três parcelas.
2. **Ele DESCREVE a alocação.** Onde o dinheiro foi parar sai por extenso, e a
   frase de quitação acompanha o que de fato foi quitado.

| Caso | Referência |
|---|---|
| uma alocação que quita a parcela | `parcela N de M` — **texto preservado**, é o caso comum |
| honorário não parcelado | `pagamento único` (sem "parcela 1 de 1", desde a F-1a) |
| múltiplas alocações | `R$ X na parcela 1 de 2 e R$ Y na parcela 2 de 2` |
| sobra em crédito | acrescenta `R$ Z mantidos como crédito para abatimento futuro` |
| adiantamento sem parcelas | `adiantamento` — sem número de parcela |

**Os valores só aparecem quando há mais de um destino ou sobra.** Enumerar
valor onde há um destino só seria ruído; a partir de dois, o total do recibo
deixa de descrever o que foi para a parcela citada — que é exatamente o defeito.

#### A frase de quitação

**Plena** só quando o pagamento não deixa nada pendente no que ele alcança: sem
crédito sobrando **e** com todas as parcelas tocadas integralmente quitadas.

> Para clareza e como prova, firmo o presente recibo, dando plena e geral
> quitação do valor acima em relação à obrigação a que se refere.

Em qualquer outro caso:

> Para clareza e como prova, firmo o presente recibo, dando quitação do valor
> acima efetivamente recebido. A quitação é PARCIAL e não alcança o saldo
> remanescente da obrigação, que permanece devido.

**A redação é PROVISÓRIA e aguarda ratificação da Laís**, como TIPOS_HONORARIO
(DEC-039). É texto jurídico entregue a terceiro, e a escolha entre "quitação
plena" e "quitação do valor recebido" tem efeito que não se decide por critério
técnico.

**O crédito do recibo sai da diferença** entre o líquido e o alocado, e não de
`Fee.saldoAdiantado`: aquele campo é do honorário e pode ter contribuição de
outros pagamentos, enquanto o recibo fala de UM. A conta fecha mesmo com
estorno no meio, porque a desalocação consome o crédito antes das parcelas.

As duas decisões vivem em funções **puras e exportadas** —
`descreverDestino` e `frasePeDeQuitacao` —, testadas pelo texto extraído do PDF
nos cinco casos.

**Limitação conhecida da ferramenta de teste, registrada para não virar
"correção" no documento:** `tests/helpers/pdfText.js`, o extrator escrito à mão
na Fase 2E.2, embaralha MAIÚSCULAS em fonte com subconjunto — "PARCIAL" sai
"PLRCILG" no texto extraído. O PDF está correto; quem abre o arquivo lê
"PARCIAL". As asserções miram o trecho minúsculo da frase, e há comentário no
teste dizendo por quê.

---

### DEC-042 — três estados de quitação, decididos pela OBRIGAÇÃO ALCANÇADA. **PROVISÓRIA** (F-1a.2)

> **Convive com a DEC-041, que segue PROVISÓRIA.** A 041 decidiu que o recibo
> *descreve a alocação*; a 042 decide *o que ele declara quitado*. As duas
> aguardam ratificação da Laís, e **nenhum recibo vai a cliente real antes
> disso**.

#### O documento que a originou (achado A-1 da F-1a.2 — GRAVE)

Recibo de **R$ 3.500,00** do seed — Agro Campos Gerais Ltda, honorário
"Honorários complementares — recurso administrativo", cobrança de R$ 3.000,00
em parcela única. O corpo dizia **certo**:

> referente a Honorários complementares — recurso administrativo — **R$ 3.000,00
> na parcela 1 de 1 e R$ 500,00 mantidos como crédito para abatimento futuro**

E o pé dizia:

> A quitação é **PARCIAL** e não alcança o **saldo remanescente da obrigação,
> que permanece devido**.

**Não havia saldo remanescente.** A parcela 1 de 1 valia R$ 3.000,00 e foi paga
integralmente; a obrigação estava quitada e **ainda sobrou crédito**. O
documento afirmava **dívida inexistente contra o cliente que pagou a mais** — e
é papel assinado pela advogada, que trabalharia contra ela em qualquer discussão
futura.

**Escopo confirmado por contraprova.** O recibo de **R$ 800,00** (Custas
administrativas, mesmo cliente, parcela única paga integral, sem sobra) dizia
corretamente "plena e geral quitação". O ramo pleno funcionava; o defeito era a
condição que tratava **sobra-em-crédito como quitação parcial**.

**A condição culpada**, em `frasePeDeQuitacao` (`src/services/receiptService.js`):

```js
const plena =
  destinos.length > 0 &&
  creditoMantido <= 0 &&          // ← tratava SOBRA como se fosse FALTA
  destinos.every((d) => d.quitaAParcela);
```

#### A regra: a pergunta certa

Não é *"sobrou dinheiro?"*. É **"o que este pagamento alcançou ficou quitado?"**.
Daí os três estados:

| # | Estado | Quando | Redação |
|---|---|---|---|
| 1 | **Plena** | as parcelas alcançadas ficaram **integralmente quitadas** — vale **mesmo havendo crédito** | duas variantes, abaixo |
| 2 | **Parcial** | alguma parcela alcançada continua com **saldo em aberto** | **inalterada** desde a DEC-041: está correta |
| 3 | **Adiantamento** | **nenhuma alocação** | texto próprio: não quita obrigação nenhuma porque não há obrigação vencida a quitar |

#### As redações, por extenso

**Estado 1 — plena SEM crédito** (a da 4.1, intacta; é o recibo de R$ 800,00):

> Para clareza e como prova, firmo o presente recibo, dando plena e geral
> quitação do valor acima em relação à obrigação a que se refere.

**Estado 1 — plena COM crédito** (é o recibo de R$ 3.500,00):

> Para clareza e como prova, firmo o presente recibo, dando plena e geral
> quitação do valor acima em relação às parcelas alcançadas por este pagamento,
> que ficaram integralmente quitadas. Os R$ 500,00 restantes não correspondem a
> obrigação em aberto: ficam registrados como crédito do contratante, para
> abatimento futuro.

**Estado 2 — parcial** (inalterada; é o recibo de R$ 4.500,00, o de R$ 1.500,00
e o de R$ 4.000,00):

> Para clareza e como prova, firmo o presente recibo, dando quitação do valor
> acima efetivamente recebido. A quitação é PARCIAL e não alcança o saldo
> remanescente da obrigação, que permanece devido.

**Estado 3 — adiantamento sem obrigação alcançada:**

> Para clareza e como prova, firmo o presente recibo, dando quitação do valor
> acima efetivamente recebido. Este pagamento não alcançou parcela alguma: não
> há obrigação vencida a quitar, e o valor recebido fica registrado como crédito
> do contratante, para abatimento futuro.

#### As regras de redação, que valem acima das frases

1. A quitação se refere **ao valor efetivamente recebido**, sempre.
2. Havendo crédito, o pé **nomeia o crédito** e diz que ele fica para abatimento
   futuro — **nunca** o descreve como dívida do cliente.
3. A palavra **"devido"** só aparece quando existe, de fato, **saldo em aberto
   numa parcela alcançada**. Provado por teste, caso a caso, sobre o texto
   extraído do PDF: `tests/financial/recibo.test.js`.

#### O que impede a reintrodução

O caso de R$ 3.500,00 está reproduzido com os mesmos números em
`recibo.test.js`, teste 3 do bloco DEC-041/042, e a asserção central é a
**ausência** da palavra "devido". O de R$ 800,00 está no teste 8, como
regressão da redação plena — e ali a frase exata é conferida sobre a **função
pura** `frasePeDeQuitacao`, porque o extrator de PDF embaralha acento e cedilha
e não consegue provar uma vírgula.

---

### A-2 da F-1a.2 — o adiantamento nomeia a parcela onde o dinheiro entrou

Recibo de **R$ 5.000,00** do seed (Maria Aparecida, adiantamento do inventário)
dizia apenas **"pagamento único"**. O saldo **foi auto-alocado** (DEC-036)
quando a parcela nasceu, mas o recibo não dizia em qual — quem recebe o papel
não conseguia ligar o dinheiro à obrigação.

**A correção.** Quando o pagamento tem alocações, o recibo as **descreve**,
qualquer que seja o `tipo` do pagamento. **"Pagamento único" fica reservado ao
caso de uma alocação que QUITA uma parcela única.** Adiantamento ainda **sem**
alocação usa o texto do **estado 3** da DEC-042.

O predicado de `descreverDestino` ganhou o terceiro caso que faltava:

```js
const enumerar =
  destinos.length > 1 ||
  (destinos.length > 0 && creditoMantido > 0) ||
  destinos.some((d) => !d.quitaAParcela);   // ← o que faltava
```

O recibo passa a dizer **"R$ 5.000,00 na parcela 1 de 1"**. A regressão de
"parcela 1 de 1 é ruído" (F-1a) continua valendo: ela só some no caso em que a
alocação quita a parcela, que é quando "pagamento único" é verdade.

---

### A-3 da F-1a.2 — o recibo de pagamento estornado não pode ser silencioso

Recibo de **R$ 2.500,00** do seed (Beatriz, usucapião) saía pelo líquido —
correto — mas **em silêncio**: o pagamento foi de R$ 4.000,00 com estorno de
R$ 1.500,00, e o documento não dizia nada disso. Para documento de prova é
lacuna: o cliente ficava com um recibo de 2.500 e **nenhum registro** do que
houve com a diferença.

**A correção.** Havendo estorno ativo, o recibo declara o valor recebido, o
valor estornado **com a data**, e que o valor acima é o **líquido**:

> Este recibo é do valor líquido: do pagamento de R$ 4.000,00 foi estornado
> R$ 1.500,00 em 18/05/2026, restando os R$ 2.500,00 acima.

O número **em destaque continua sendo o líquido** — é o que a advogada recebeu
de fato. O que se acrescenta é a conta que leva até ele.

**O motivo do estorno NÃO entra no texto.** O campo pode estar vazio, e inventar
motivo em documento assinado é pior que omiti-lo. Há asserção travando isso.

A lista de estornos que entra na frase é o espelho de `totalEstornado`:
anulação não é débito, e estorno anulado não conta — senão o recibo declararia
um estorno que foi desfeito.

---

### A-3 e A-4 do smoke test — leitura, não conta (F-1a.1)

**A-3 — parcela reparcelada exibia dívida fantasma.** Parcela `cancelado` com
`reparcelamentoId` imprimia "em aberto R$ 2.250,00" na ficha. Ela **não entrava
em soma nenhuma** — isso já valia. O problema era de leitura, e leitura é o que
a ficha é.

A ficha passa a enviar `reparcelamentoId` e `reparceladaEm` (a data da
operação). A tela mostra rótulo **"Reparcelada"** — distinto de cancelamento
avulso, porque uma cobrança cancelada foi desfeita e uma reparcelada foi
SUBSTITUÍDA —, omite o "em aberto", atenua a linha e diz por qual operação ela
saiu. **Valor e recebido ficam**: é histórico auditável, e omitir a parcela
inteira levaria junto o registro de que aquela cobrança existiu.

**A-4 — a busca perdia o foco.** Causa estrutural, confirmada por leitura antes
da correção: `if (loading) return <Loading />` trocava a **árvore inteira** —
inclusive o input — a cada refetch, e o React desmontava e remontava o campo.
Não era `key`.

Corrigido nas **cinco** listagens com filtro próprio (clientes, honorários,
processos, pagamentos, parcelas), movendo o indicador para dentro do JSX,
abaixo dos controles. `SecaoListPage` já nascia com o padrão certo e serviu de
referência. As telas de DETALHE não têm o defeito: o `loading` delas é do
carregamento inicial e não volta a `true`.

**Não se corrigiu com `autoFocus` nem `.focus()` em efeito.** Os dois tratam o
sintoma e criam um defeito pior — roubam o foco de quem navega por teclado, e
num efeito disparado por refetch fazem isso a cada tecla.

**Não há como provar foco sem DOM.** `tests/regressions/f1a1.test.js` trava a
CAUSA por varredura estática (nenhuma listagem com filtro pode ter o `return`
antecipado, e nenhuma pode usar as duas saídas fáceis), e o passo **155** do
roteiro manual fecha a outra metade. Inventar um teste de foco frágil seria
pior que o passo manual honesto.
### A divisão F-1a / F-1b / F-1c

**Decisão registrada:** o escopo original da Fase F-1 não cabia numa sessão e
foi dividido em três. Não é adiamento — é o reconhecimento de que backend novo,
seed novo, onze invariantes, telas ricas e roteiro manual numa entrega só
produziriam ou uma sessão pela metade ou um merge sem prova.

| Fase | Escopo |
|---|---|
| **F-1a** (esta) | backend completo, seed refeito, os 11 invariantes provados, frontend só o suficiente para o app funcionar |
| **F-1b** | UX do dinheiro: preview de alocação na tela, estorno em modal, extrato com vínculos, paginador real |
| **F-1c** | reparcelamento ponta a ponta na tela, navegação honorário↔parcelas, e a **seção 21 do roteiro manual** |

**Nenhuma seção nova entrou no roteiro manual nesta fase, e é deliberado.** A
seção 21 nasce na F-1c, quando as telas que ela descreveria existirem. Um passo
de validação visual sobre uma tela que ainda não foi desenhada é passo que
reprova por motivo errado — e a conta do roteiro (154 passos) fica parada de
propósito, não por esquecimento.

**O que a F-1a deixou PRONTO e sem tela**, para a F-1b não precisar de backend:
`POST /payments/preview`, `GET /fees/:id/statement` com os vínculos completos,
`GET /payments/:id/reversals` e `GET /financeiro/processos/:id/payments`. Os
quatro estão testados e cobertos pela varredura de isolamento.


### Fase F-0 — Ponto de restauração e faxina do backlog

**Resumo:** a tag de restauração publicada no GitHub, e depois a limpeza dos
achados P/M da Auditoria de Retomada — paginação, filtros, allowlist de upload,
mensagens, logger de produção e segredos de teste. Backend 327 → **346**.
Frontend 250 → **264**. Roteiro manual 147 → **154** passos.

**Ponto de restauração (Parte 0, antes de qualquer edição):** tag anotada
`v-pre-f0-2026-08-16` e branch `backup/pre-f0-main`, publicadas nos DOIS
repositórios, apontando para `4f3e0ee` (back) e `0ef1ecb` (front). Restaurar:
`git checkout v-pre-f0-2026-08-16`, ou `git reset --hard v-pre-f0-2026-08-16`
na `main` — com a ressalva do limite permanente: reescrever histórico
publicado é decisão explícita, não rotina.

**Arquivos novos (backend):** `utils/logError.js`.
**Arquivos novos (frontend):** `src/api/baseURL.js`, `.env.production.example`,
`tests/regressions/f0.test.js`.

**DUAS MUDANÇAS DE CONTRATO, as duas deliberadas:**

1. **Id de filtro malformado responde 400 com `campo`**, nos quatro módulos.
   Ver o bloco próprio abaixo.
2. **`urlArquivo`, `tamanho` e `dataUpload` saíram da allowlist de PATCH de
   `/documents`.** A decisão 16 diz que o upload está dormente; a allowlist o
   mantinha aberto para escrita, e um documento **gerado** podia passar a
   declarar que veio de arquivo enviado. Dormente passa a valer para escrita
   também. `origem` fica, porque a validação já o recusa com mensagem própria.

**Decisões**, com o porquê no código:

- **O build de produção do frontend FALHA sem `VITE_API_URL`.** Era o achado
  mais grave da auditoria: `npm run build` saía com sucesso embutindo
  `http://localhost:3001/api`, e o deploy subia e falhava em toda requisição.
  Nem `lint`, nem `build`, nem as duas suítes acusavam — não há erro no
  código, o defeito é a ausência de uma variável. Por isso a guarda vive no
  `vite.config.js`, e não num teste. `npm run dev` continua sem exigir nada.
- **A URL base virou módulo único** (`api/baseURL.js`), consumido pelas duas
  instâncias de axios. O fallback é guardado por `import.meta.env.DEV` na
  forma LITERAL, que é a única que o Vite substitui por `false` — assim o ramo
  vira código morto e o endereço de desenvolvimento **desaparece do bundle**.
  A primeira versão lia a flag de um parâmetro, e o `grep` no `dist/` pegou o
  literal sobrevivendo.
- **`contarNaoVistas` foi MANTIDA e ligada**, não apagada: o dashboard
  reescrevia a mesma consulta à mão e a função existia sem chamador.
- **`bcryptjs` 3.x adiado** — major no caminho de autenticação dos dois
  domínios. Ver o bloco de dependências.
- **Log de 5xx em produção** sem biblioteca (`utils/logError.js`): carimbo,
  método, **padrão** da rota, status e mensagem. Sem corpo, sem query, sem
  cookie, sem `req.user` — a advogada é controladora de dado de terceiro, e
  log sobrevive ao incidente, é copiado para triagem e raramente é apagado.
- **Segredo de teste rotacionado.** `.env.test.example` trazia valores
  literais e o `.env.test` em uso era cópia fiel deles, num repositório
  **público**. Viraram placeholders; os segredos locais foram regerados.
  Nenhuma credencial de banco esteve exposta — o `MONGO_URI_TEST` do exemplo
  sempre foi placeholder.

**Três premissas da auditoria que NÃO se confirmaram, corrigidas aqui:**

1. **As `RATE_LIMIT_*` já estavam documentadas** no `.env.example`, comentadas
   com os defaults (linhas 37-56). A varredura da auditoria contou só linhas
   não comentadas. **Nada a fazer** — o item 6.8 já estava satisfeito.
2. **Os segredos do `.env.test.example` não eram strings aleatórias
   vazadas**, e sim placeholders descritivos
   (`segredo-de-teste-nao-usar-em-producao`) que o `.env.test` local copiou
   verbatim. O efeito prático é o mesmo — segredo de teste público — e a
   correção também; a caracterização é que estava errada.
3. **`escapeRegex` tinha QUATRO cópias, não três**: `feeService`,
   `clientService`, `processService` e a `escaparRegex` privada de
   `utils/texto.js`. Unificadas em `utils/texto.js`, junto com um
   `regexTermoSimples` para os três campos de busca.

**Um erro meu, pego pelo próprio teste que eu tinha acabado de escrever:** a
varredura que proíbe a diretiva `eslint-env` no `public/sw.js` derrubou o
comentário que EXPLICA a remoção, porque a explicação reproduzia a diretiva.
É o trap que `css/foco.test.js` documenta desde a 4.5, e eu caí nele na fase
seguinte. A varredura passou a procurar a forma de diretiva, e o comentário
deixou de soletrá-la.

**Não tocado:** `documentRenderService.js`, `letterheadService.js`, catálogo
de variáveis, contrato das rotas do portal, envelope de `/auth`, model nenhum.
**Nenhuma dependência nova** — só as duas versões da Parte 6.4.

---

### Semântica única do id de filtro inválido (Fase F-0)

**MUDANÇA DE CONTRATO.** Antes, o mesmo parâmetro malformado tinha quatro
comportamentos, medidos contra o seed:

| Rota | Antes | Depois |
|---|---|---|
| `GET /documents?processoId=xyz` | 200, total **19** — a listagem INTEIRA | **400** `campo: "processoId"` |
| `GET /fees?processoId=xyz` | 200, total **12** — idem | **400** |
| `GET /installments?processoId=xyz` | 200, total **0** — lista vazia | **400** |
| `GET /payments?processoId=xyz` | 200, total **0** — idem | **400** |

Os dois primeiros são o pior caso: um id torto vindo de um link mostrava a base
inteira no lugar do recorte pedido, sem nada na resposta dizendo que o filtro
não foi aplicado. Os dois últimos mentiam ao contrário — "não há nada aqui".

**Filtro AUSENTE continua sendo "sem filtro"**, e não 400: `?processoId=` vazio
ou parâmetro nenhum é a listagem normal. A recusa é só para o que foi enviado e
não serve.

**Texto continua sendo descartado, e a assimetria é proposital.** `?busca=` ou
`?tipo=` com valor estranho não vira 400: um id malformado significa que a tela
montou uma URL errada; um texto estranho significa que alguém digitou algo
estranho. A guarda mora em `filtroObjectIdExigido` / `filtroTexto`
(`utils/filtrosDeConsulta.js`), agora aplicada aos **doze** filtros — a Fase
4.5 tinha alcançado quatro.

### Paginação nas listagens por processo (Fase F-0)

`installmentService` e `paymentService` tinham um `return` antecipado sob
`if (processoId)` que fazia **três** coisas erradas de uma vez:

1. pulava `skip`/`limit` e devolvia o conjunto inteiro, com `limit: data.length`
   — violando a regra central nº 4 (paginação obrigatória, teto 100);
2. em `/payments`, ficava **antes** da linha que aplica `installmentId`, então
   `?processoId=X&installmentId=Y` descartava o segundo filtro em silêncio.
   Medido: `?installmentId=Y` devolvia 1 e os dois juntos devolviam **3** —
   combinar dois filtros dava MAIS linhas;
3. devolvia `{ data: [], total: 0, limit: 0, totalPages: 1 }` para id inválido.

Os três saíram juntos, porque eram o mesmo atalho.

**Consequência na tela, tratada na mesma fase.** `PaymentListPage` e
`InstallmentListPage` renderizam o array inteiro, sem paginador — funcionavam
por causa do defeito. Corrigido o backend, o default de 20 passaria a truncar em
silêncio. As duas passaram a pedir o **teto de 100** explicitamente e a exibir
"Mostrando N de M" quando o conjunto é maior. Paginador de verdade é da F-1,
que reescreve estas telas; truncar sem avisar não podia sobreviver a esta.

### Fase F-1a — Financeiro 2.0: backend completo, seed e os 11 invariantes

**Resumo:** a branch da fundação (`2c639ee`) trazia os models, o motor de
alocação e o service de estorno, mas `src/app.js` **não subia** — os
consumidores antigos importavam símbolos que o modelo novo removeu. Esta fase
os religou, refez o seed, provou os onze invariantes e tocou o frontend só o
suficiente. Backend 346 → **395**. Frontend 264 → **289**.

**Commits:** `8f41fbf` (backend + seed + invariantes), `f97a573` (adaptação da
suíte), `00c608a` (frontend, no outro repositório).

**Arquivos novos (backend):** `services/renegotiationService.js`,
`services/statementService.js`, `controllers/reversalController.js`,
`controllers/renegotiationController.js`, `controllers/statementController.js`,
`validations/reversalValidation.js`, `validations/renegotiationValidation.js`,
`tests/financial/financeiro2.test.js`.

**Arquivos novos (frontend):** `pages/payments/allocationSummary.js`,
`pages/payments/paymentRow.js`, `tests/financial/financeiro2.test.js`.

**Decisões**, todas por extenso no bloco "Financeiro 2.0 — DEC-032 a DEC-039",
acima: pagamento imutável; estorno como registro e não como campo; as duas
rotas de reativação mortas; o motor de alocação com ordens opostas; o saldo
adiantado para que nada se perca; reparcelamento com vínculo e soma exigida; o
histórico de status com origem viajando pela cadeia; e o vocabulário de tipo de
honorário em arquivo próprio, **provisório**.

**Um desvio deliberado em relação à fundação**, com o motivo escrito no
cabeçalho de `allocationService.js`: `adiantamento` deixou de curto-circuitar
para o saldo e passa pelo MESMO planejamento de `comum`. A fundação tinha dois
motores por tipo para a mesma pergunta, e o cabeçalho do próprio `Payment.js`
já dizia que o tipo é do PEDIDO e não do resultado. Num honorário sem parcelas o
resultado é idêntico ao de antes.

**Dois defeitos meus, pegos pela própria suíte:**

1. `paymentService.update` tinha deixado de chamar `validateUpdatePayment` ao
   ser reescrito. A varredura estática de `tests/integrity/allowlist.test.js`,
   escrita na Fase 4.5 justamente para travar o LUGAR da validação, caiu na
   hora — é o teste provando o que foi escrito para provar.
2. O recibo passou a escrever "parcela 1 de 1" num honorário não parcelado, ao
   ganhar o caso de duas parcelas.

**Uma premissa MINHA que não se sustentou**, corrigida no teste e não no
código: o invariante 9 media a origem `reparcelamento` num cenário em que o
status do honorário **não muda** (uma parcela `pago` sobrevive ao
reparcelamento e o mantém `parcialmente_pago`). `registrarStatus` não grava
linha para status igual, por desenho. Era o teste que estava errado.

**Nenhum teste foi apagado.** Os que mediam comportamento revogado foram
INVERTIDOS no lugar, no padrão que a Fase 4.1 usou com a DEC-028: o 409 de
excedente virou o teste da alocação que o substituiu e da AUSÊNCIA da regra;
`tests/integrity/reativacao.test.js` virou o teste dos 404 e das duas premissas
estruturais que ele já protegia.

**Não tocado:** `documentRenderService.js`, `letterheadService.js`, catálogo de
variáveis, contrato das rotas do portal, envelope de `/auth`, vetores da
fórmula percentual. **Nenhuma dependência nova** — `package.json` idêntico a
`main` nos dois repositórios.

**Roteiro manual: nenhuma seção nova** (ver "A divisão F-1a/b/c").

### Fase F-1a.1 — correções do smoke test do Financeiro 2.0

**Resumo:** quatro achados de um smoke test manual do Daniel na main mergeada
da F-1a. Dois são de dinheiro e um sai impresso em recibo assinado — por isso
vieram antes da F-1b, que construiria telas ricas sobre números errados.
Backend 395 → **407**. Frontend 289 → **305**. Roteiro 154 → **157**.

**Nada de UX nova**: preview de alocação, página do honorário, paginador e
filtro por honorário continuam sendo F-1b.

**Arquivos alterados (backend):** `services/financeiroService.js`,
`services/dashboardService.js`, `services/renegotiationService.js`,
`services/receiptService.js`, `tests/financial/financeiro2.test.js`,
`tests/financial/invariantes.test.js`, `tests/financial/recibo.test.js`.

**Arquivos novos (frontend):** `tests/regressions/f1a1.test.js`.
**Alterados:** `components/financeiro/ProcessFinancialSheet.jsx` + `.css`,
`utils/statusVisual.js`, e as cinco listagens com filtro
(`ClientListPage`, `FeeListPage`, `ProcessListPage`, `PaymentListPage`,
`InstallmentListPage`).

**Decisões:** DEC-040 (piso zero + crédito nomeado, substituindo a decisão nº 4
da F-1a) e DEC-041 (recibo por alocação, **provisória**), as duas por extenso
acima, com o caso numérico observado — é o que impede a reintrodução.

**Um defeito MEU da F-1a, corrigido aqui.** A decisão nº 4 daquela fase dizia
que "`emAberto` pode ficar negativo, e é honesto". A preocupação estava certa —
não esconder dinheiro da cliente — e a execução, errada: o negativo propagava
para a soma do processo, e ali o crédito de um honorário abatia a dívida de
outro. A correção mantém o dinheiro visível, em campo próprio e com nome.

**Um teste meu que não testava.** O invariante 6 recomputava a mesma fórmula
que a API usara e comparava consigo mesma. Passou verde durante toda a F-1a com
o defeito presente. Reescrito com verificação independente.

**Uma premissa do roteiro desta fase que não se confirmou:** `valorVencido` e
`aReceberNoMes` carregavam METADE do defeito, não ele inteiro — somam o em
aberto de PARCELA, que nunca subtraiu `saldoAdiantado`. Ver a nota na DEC-040.

**Não tocado:** `documentRenderService.js`, `letterheadService.js`, timbrado,
catálogo de variáveis, rotas do portal, vetores da fórmula percentual (hash
travado), contrato de rota nenhum além dos dois campos novos da ficha.
**Nenhuma dependência nova.**

---

---

### DEC-043 — o preview de alocação é `POST /payments/preview`, e o plano tem UMA fonte (F-1b)

#### A decisão

A tela precisa mostrar, **antes de a advogada confirmar**, em quais parcelas o
dinheiro vai encostar. A rota que responde isso é:

```
POST /api/payments/preview
     { honorarioId, valor, tipo }  →  { destinos[], sobra,
                                        saldoAdiantadoAtual, saldoAdiantadoDepois }
```

Ela **não grava nada** e já existia desde a F-1a, criada junto com o motor. A
F-1b a manteve, ligou a tela nela e **travou a invariante que a sustenta**.

#### Por que POST, e não `GET /payments/:id/allocation-preview`

O roteiro desta fase sugeria a alternativa `GET /payments/:id/allocation-preview`.
Ela não é implementável, e o motivo não é de estilo: **no momento do preview o
pagamento não existe** — é justamente o que se está decidindo criar. Não há
`:id` para pôr na URL. Um `GET` com `honorarioId`, `valor` e `tipo` na query
funcionaria, mas:

1. o corpo é o mesmo do `POST /payments`, e mantê-los idênticos é o que faz o
   preview e a criação serem comparáveis — em query string, `valor` viraria
   texto e ganharia uma conversão que a criação não tem;
2. "o que aconteceria se eu registrasse este pagamento agora" é resposta
   **volátil**: depende do estado das parcelas neste instante. `GET` é
   cacheável por definição, e um preview servido do cache é um preview que
   mente;
3. a rota já estava publicada e testada como `POST` desde a F-1a. Trocar o
   verbo agora seria churn de contrato sem ganho.

#### A regra que não pode ser afrouxada: UMA fonte para o plano

O preview e a criação usam **a mesma função**, `planejarAlocacao`
(`services/allocationService.js`), que é pura e não toca o banco:

| Caminho | Quem chama | Grava? |
|---|---|---|
| `POST /payments/preview` | `paymentService.preverAlocacao` | não |
| `POST /payments` | `allocationService.alocarPagamento` | sim |
| parcela nova nasce (DEC-036) | `allocationService.autoAlocarSaldo` | sim |

**Se o preview divergir da criação, o preview mente** — e mentir aqui é pior
que não ter preview, porque a advogada decide com base nele e só descobre
depois de o dinheiro estar gravado. A garantia é estrutural (uma função só),
mas garantia estrutural se perde num refactor distraído, então ela também é
**medida pela ponta de fora**: `tests/financial/f1b.test.js`, bloco 1, manda a
mesma entrada pelos dois caminhos e compara **parcela por parcela, na ordem**,
mais a sobra. É a asserção mais importante da fase.

A ordem entra na comparação de propósito: um preview que acertasse os valores
na ordem errada diria que a parcela 3 será quitada antes da 2.

**Corolário para a tela:** o frontend **formata** o plano e não o recalcula.
`pages/payments/allocationPreview.js` não ordena, não soma e não decide o que
cabe em cada parcela — há teste estático proibindo `sort`, `Math.min` e
`Math.max` nesse arquivo. O mesmo formatador serve ao previsto e ao realizado
(o 201 devolve a mesma forma), porque dois formatadores poderiam discordar
sobre números que precisam bater.

#### O que mudou de arquivo junto, e por quê

A conta dos totais do honorário da **DEC-040** (`emAberto = max(0, contratado −
pagoLiquidoAlocado)`, com o crédito à parte) vivia **dentro** de
`montarFichaFinanceira`. A página do honorário da F-1b precisa dos mesmos
quatro números, e o caminho barato seria repetir a fórmula.

Ela saiu inteira para **`services/feeTotals.js`**, e a ficha passou a chamá-la.
É o mesmo princípio do preview, um nível acima: **uma pergunta sobre dinheiro,
uma fórmula**. `tests/financial/f1b.test.js`, bloco 3, compara os totais de
`GET /fees/:id` com os da ficha, chave por chave — mover fórmula de dinheiro
exige uma asserção dizendo que as duas leituras continuam concordando.

#### `GET /fees/:id` ficou mais gordo, e é aditivo

Passou a devolver, ao lado dos campos de sempre: `cliente` (o principal do
processo, com o nome já resolvido por tipo de pessoa), `totais`, `parcelas` (com
`emAberto` com piso e o vínculo do reparcelamento) e `contagemParcelas`.

As parcelas vêm **aqui** e não de `GET /installments?feeId=` porque esse filtro
não existe, e criá-lo é trabalho de **listagem** — escopo declarado da F-1b.2.
As parcelas de um honorário não são uma listagem: são o próprio honorário visto
por baixo, como a ficha já as aninha, e não paginam pela mesma razão (meia lista
faria os totais do cabeçalho não fecharem com as linhas embaixo).

---

### A divisão F-1b / F-1b.2 / F-1c — e por que ela existe

A F-1 original **morreu por escopo grande demais numa sessão**. O recorte
abaixo é deliberado, e cada fase termina com suíte verde e merge.

**F-1b (esta) — a UX do dinheiro.** A página do honorário
(`/dashboard/honorarios/:id`), o extrato na linha do tempo com os vínculos, o
preview de alocação, o estorno e a anulação em modal, e o nome do honorário
virando link em toda tela onde ele aparece.

**F-1b.2 — as listagens.** *(Escrito durante a F-1b. Só parte disto virou a
F-1b.2; ver a **DEC-044** e "O que fica para a F-1b.3" no fim deste arquivo.)*
Paginador real, filtro por honorário, barra de busca em pagamentos, filtro por
período nas três listagens financeiras, badge "estornado integralmente" na
coluna do valor, coluna de honorário legível, e **moeda que nunca trunca**.

**O que a F-1b.2 de fato fez:** o badge, a coluna de honorário legível e a
moeda que nunca trunca — mais o que este texto não previa, e que a execução do
roteiro em 18/08/2026 revelou: a **DEC-044** (o extrato se lê sem somar errado)
e a **responsividade** das cinco telas da fase. **Os filtros e o paginador
foram para a F-1b.3.**

**F-1b.3 — achar o lançamento (19/08/2026, feita).** Os filtros e o paginador
que sobraram, mais duas coisas que a execução do roteiro em 19/08 revelou: a
**DEC-045** (a referência do pagamento é valor e forma, não o sufixo do id — o
passo 166) e o **menu de três pontos** (a coluna Ações da listagem de
pagamentos cortava o terceiro botão — o passo 168). Ver a seção própria no fim
deste arquivo.

**F-1c — o reparcelamento ponta a ponta.** O backend já reparcela (DEC-037); o
botão existe na página do honorário **desabilitado, dizendo que chega na F-1c**.
Junto vai a leitura do "parcela 1 de N" pós-reparcelamento (a observação do
passo 156, item 6, endereçada à Laís) e a seção do roteiro que valida o módulo
financeiro inteiro.

---

### DEC-044 — toda linha do extrato que deixou de valer DIZ que deixou de valer (F-1b.2)

#### O defeito, com o caso real

Estornar R$ 1.000,00 de um pagamento de R$ 4.500,00 e depois **anular** o
estorno deixa o extrato do honorário assim:

```
Alocação   R$ 3.000,00   ← viva
Alocação   R$ 1.500,00   ← desfeita pelo estorno (nada dizia isso)
Alocação   R$   500,00   ← substituta: o resto da de 1.500 (nada dizia isso)
Alocação   R$ 1.000,00   ← nasceu da anulação
           ───────────
           R$ 6.000,00   para um pagamento de R$ 4.500,00
```

**A conta do sistema está certa.** A alocação de 1.500 tem `estornoId`
preenchido, não entra em `pagoLiquidoAlocado`, e `totais.pago` responde 4.500.
Há uma desalocação de 1.500 compensando na lista. O que estava errado é a
**leitura**: quem lê de cima a baixo soma 6.000 e não tem como saber que uma
das linhas foi desfeita.

A assimetria era o ponto. O **estorno anulado** já recebia o tratamento certo
desde a F-1b (`anulado: true`, e a tela escreve "este estorno foi anulado
depois"). A **alocação desfeita** não recebia nenhum: o contrato expunha
`ativa: false` — um booleano que diz **que** ela caiu e não diz **quando** nem
**por quê** —, e com isso a tela não tinha como escrever a frase sem inventar
ou sem abrir uma segunda leitura por linha.

#### A regra

> **Nenhuma linha do extrato pode ser somada por quem lê e dar um total que o
> sistema não reconhece. Se uma linha não vale mais, ela diz isso.**

#### O que mudou no contrato

Nenhum campo novo é **conta nova**. Todos são vínculos que já existiam nos
registros e que o extrato não estava expondo.

Na linha de **alocação**:

| Campo | O que responde |
|---|---|
| `desfeitaEm` | *quando* (é `Allocation.desalocadoEm`, a data do estorno) |
| `estornoQueDesfezId` | *por qual estorno* |
| `valorEstornoQueDesfez` | o valor dele, para a frase da tela |
| `substituiAlocacaoId` | de qual alocação esta é o **resto** |
| `estornoQueGerouId` | qual estorno a produziu |
| `valorEstornoQueGerou` | o valor dele |
| `dataPagamento` | a data **real** do pagamento (ver abaixo) |

Na linha de **desalocação**: `estornoAnulado` — se o estorno que a causou foi
anulado depois, o dinheiro que ela tirou já voltou, e sem a ressalva quem lê
subtrai duas vezes. Simetria com o `anulado` da linha do estorno.

#### `Allocation` ganhou dois campos, e por que não dava para derivá-los

`substituiAlocacaoId` e `estornoOrigemId`, gravados **uma vez, na criação**,
em `allocationService.desalocarPorEstorno`.

A substituta nascia indistinguível de uma alocação original: mesmo
`pagamentoId`, mesma `parcelaId` e — porque ela **herda `data` da original** —
a mesma data do pagamento. No extrato ela aparecia no meio das originais
daquele dia, e o bloco do dia passava a alocar mais do que o pagamento tinha.

Derivar por heurística (mesma parcela, mesmo pagamento, `createdAt` posterior)
seria adivinhação: duas alocações legítimas na mesma parcela **existem** quando
uma anulação realoca. Por isso o vínculo é gravado, como todo vínculo deste
modelo. São campos opcionais com `default: null` — registro antigo continua
válido e simplesmente não se declara substituto.

#### `dataPagamento` corrigiu uma AFIRMAÇÃO ERRADA

A alocação criada pela **anulação** grava `data: anulacao.data`. A frase da tela
("Do pagamento de {data}") usava a data do evento: no caso acima ela dizia "Do
pagamento de 18/08/2026" para um pagamento de **08/05/2026** — uma data em que
pagamento nenhum aconteceu. O extrato passa a expor a data real do pagamento ao
lado do `pagamentoId`, nas linhas de alocação **e** de desalocação.

#### A ordem cronológica é DECISÃO consciente

O extrato lista **do mais antigo para o mais novo**, contrário ao que o prompt
da F-1b pediu. **Fica assim, e por escrito:** extrato conta uma história, e
história se lê do começo. É também o que torna verificável a regra acima —
somar as alocações vivas de cima para baixo e bater com o pagamento.

Detalhe que o teste fixa: a criação do honorário **não** é necessariamente a
primeira linha. `historicoStatus` é carimbado com o instante real da criação
(DEC-038), e um pagamento com `data` retroativa — o caso normal, lançar em
agosto o PIX que caiu em maio — o antecede. Ordenar por instante de gravação
contaria a história na ordem em que foi digitada, não na em que aconteceu.

#### Custo

Nenhum. O extrato já carregava estornos e pagamentos em memória (`estornoPorId`,
`pagamentoPorId`) para resolver os outros vínculos; os campos novos são leitura
desses mapas. Continuam sendo seis consultas por chamada, todas por índice e
escopadas a um honorário.

#### Testes

`tests/financial/f1b2.test.js`, 13 testes em 6 blocos. O que dá nome à fase:

```
soma das alocações exibidas  = R$ 6.000,00   ← o defeito
soma das alocações VIVAS     = R$ 4.500,00   ← o pagamento
totais.pago                  = R$ 4.500,00   ← e a ficha concorda (DEC-040)
```

Mais: toda desfeita tem marca, alocação viva não tem marca disfarçada de `null`,
a substituta aponta a alocação certa, dois pagamentos no mesmo dia têm sufixos
de 6 caracteres distintos, e os totais da DEC-040 não mudaram.

---

## Fase F-1b.3 — os filtros que faltavam (19/08/2026)

**A pergunta da fase:** achar um lançamento sem precisar lembrar de qual
honorário ele é. No backend, isso são três filtros novos nas três listagens
financeiras, no padrão da F-0 (id inválido → **400 com `campo`**, guardas de
tipo, filtros compostos em **AND**, filtro ausente não filtra).

### O que cada rota ganhou

| Rota | Filtros novos | Recorte do período |
|---|---|---|
| `GET /api/payments` | `busca`, `de`/`ate` (`honorarioId` já existia desde a F-1a) | `data` — a data do pagamento |
| `GET /api/installments` | `honorarioId`, `busca`, `de`/`ate` | `dataVencimento` |
| `GET /api/fees` | `de`/`ate`; `busca` **alargou** | `dataVencimento` |

**`?honorarioId=` em `/installments` é o `feeId` do schema, com o nome que a
tela usa.** Dois nomes para o mesmo recorte, um por rota, obrigaria a tela a
lembrar qual é qual — e o `campo` do 400 nomeia o **parâmetro**, não a coluna,
porque é o parâmetro que a tela precisa para saber qual controle montou a URL
errada.

Isso fecha a dívida anotada em `feeService.getFeeById` na F-1b ("esse filtro
não existe, e criá-lo é trabalho de listagem"). A página do honorário **continua
aninhando** as parcelas, pelo motivo que aquele comentário dá: os totais do
cabeçalho têm de fechar com as linhas embaixo, e meia lista quebraria isso.

### `?busca=` — três alvos, e o que ficou de fora

`services/buscaFinanceira.js`. Casa a **descrição do honorário**, o **número do
processo** e — só onde o campo existe — as **observações**.

**Por que projeção, e não `$lookup`.** Descrição e número vivem em outras
coleções, e `Payment` guarda delas só o id. Três saídas:

1. agregação com `$lookup` — join com varredura por página, sem índice
   utilizável para o regex;
2. campo sombra desnormalizado — rápido de ler, caro de manter: toda edição de
   descrição teria de reescrever os pagamentos, e o dia em que uma falhar a
   busca mente;
3. **duas consultas de projeção (`_id` apenas)** sobre coleções pequenas —
   honorários e processos são dezenas por usuária —, e o filtro principal vira
   `$in` sobre índice.

Escolhida a 3. **Alcance reduzido e declarado:** `observacoes` só existe em
`Payment`; em parcelas e honorários a busca casa descrição e número, e nada
mais. Um teste fixa isso nos dois sentidos, para o alcance não crescer por
acidente nem encolher em silêncio.

`regexTermoSimples`/`escaparRegex` (unificados na F-0) continuam sendo a única
porta: `?busca=.*` devolve **0**, não a base inteira.

### `?de=`/`?ate=` — e a divergência de fuso, declarada

`utils/filtrosDeConsulta.js`: `filtroDataExigida` e `filtroPeriodo`.

O enunciado da fase pediu "interpretação em fuso local, o mesmo tratamento que o
resumo do dashboard já usa para `mesReferencia`". **Medido no código, o resumo
faz o contrário do que o enunciado supõe:** ele recorta em **UTC**
(`Date.UTC(ano, mes, 1)`), e o comentário de lá diz por quê — `dataVencimento` e
`dataPagamento` são datas SEM hora, chegam como `"2026-08-31"`, o Mongoose as
grava em meia-noite UTC e o frontend as renderiza com `timeZone: "UTC"`.

**Adotado UTC**, que é o que o dashboard de fato faz. Recortar em fuso local
devolveria, num servidor a oeste de Greenwich, uma parcela de 01/09 dentro de
`ate=2026-08-31` — porque 01/09T00:00Z é 31/08 às 21h em Brasília. A data é
gravada, exibida e agora filtrada no mesmo fuso; é essa coerência, e não o fuso
em si, que faz o filtro devolver o que a linha da tabela mostra.

Regras:

- bordas **inclusivas**: `de` → 00:00:00.000Z, `ate` → 23:59:59.999Z do mesmo
  dia. Um `ate` em meia-noite excluiria o dia inteiro que a pessoa digitou;
- um sem o outro é período aberto de um lado;
- data fora do formato `AAAA-MM-DD` → 400 com `campo`;
- **data que não existe** (`2026-02-31`) → 400. `Date.UTC` a normalizaria para
  03/03 em silêncio; a volta pelo `getUTC*` recusa em vez de deslizar;
- `de` > `ate` → 400 que **explica** ("inverta as duas datas"), e não lista
  vazia: uma lista vazia para um período impossível é indistinguível de "não há
  lançamentos nesse período", e faria procurar o lançamento em vez de olhar as
  duas datas.

### DEC-045 — a referência do pagamento é o que o humano reconhece

**O defeito, com o caso real (passo 166 do roteiro).** Dois pagamentos do mesmo
dia saíram referenciados no extrato como **#e66b7a** e **#e66b7c** — diferem no
**último** caractere. A suíte provava que não colidiam, e ninguém casava as
linhas de relance.

**A causa é estrutural, não azar:** os seis últimos hex de um ObjectId são o
**contador**, que incrementa de 1 em 1. Pagamentos criados em sequência
**sempre** colidem no prefixo desses seis — que é por onde o olho lê. O próprio
passo previu a revisão: "se os seis caracteres não servirem para casar as
linhas, eles são ruído".

**A decisão.** O vínculo passa a nomear o pagamento por **valor** e **forma**,
além da data. O sufixo do id permanece como **desempate** do caso degenerado
(dois pagamentos idênticos em valor, forma e data), mas deixa de ser a
referência principal.

**No backend, isso é uma linha de contrato:** as entradas `alocacao` e
`desalocacao` do extrato passaram a carregar `valorPagamento` e
`formaPagamento`, ao lado do `dataPagamento` que a DEC-044 já tinha posto.
Ambos vêm **`null`** quando não há pagamento por trás (alocação de saldo
adiantado) — a tela escreve "de saldo adiantado" nesse caso, e um valor
inventado ali afirmaria um pagamento que não aconteceu.

Quem monta a frase é o frontend (`components/financeiro/statementEntry.js`),
função pura, testada como função pura. O backend não escreve frase.

### `totalPages` de conjunto vazio continua **0**

Comportamento da F-0, preservado de propósito nas quatro rotas: `Math.ceil(0 /
limit)` é 0. Quem normaliza para 1 é o frontend (`paginacao.js`), porque
"página 1 de 0" não é uma posição em que alguém possa estar — mas isso é
decisão de **exibição**. Mudar o envelope mexeria em quatro rotas e em todo
teste que lê `totalPages`, para resolver um problema que não é do contrato.

---

---

## DEC-046 — o menu de ações é renderizado em portal (F-1b.3.1, só frontend)

**O backend não foi tocado nesta fase.** A decisão fica registrada aqui porque
o log de DEC é **compartilhado** e numerado em série pelos dois repos: quem
procurar "DEC-046" a partir daqui precisa achar, e não concluir que o número
foi pulado. A implementação e o detalhe estão no **CLAUDE.md do frontend**.

**O defeito.** O painel do menu de três pontos das listagens financeiras
(Pagamentos, Parcelas, Honorários) **saía da tela, cortado**. O botão recebia
foco e abria o painel — o comportamento estava certo, o posicionamento não.

**A causa.** O painel era `position: absolute` e **todo ancestral com
`overflow` diferente de `visible` recorta descendente posicionado**. Havia
três, aninhados: a própria célula (`.data-table--fixed td`,
`overflow: hidden`), o wrapper de rolagem da tabela (`.table-wrapper`,
`overflow-x: auto` — e um eixo `auto` faz o outro computar `auto` junto) e o
`.main-content` (`overflow-y: auto`). **Recorte não é ordem de pintura:**
nenhum `z-index` atravessa isso.

**A solução.** `createPortal` no `document.body` + `position: fixed` +
coordenadas do gatilho por `getBoundingClientRect()`, com virada **horizontal**
(360 px) e **vertical** (última linha), coordenada nunca fora do viewport, e
**fechar ao rolar** (`scroll` em captura, porque `scroll` não borbulha) e ao
redimensionar. Zero dependência nova — `react-dom` já estava lá.

**A consequência de projeto.** Qualquer flutuante futuro dentro de tabela
rolável — tooltip, popover, seletor de data — tem o mesmo problema e a mesma
solução.

**Suítes na F-1b.3.1:** frontend **479** testes (31 novos em
`tests/regressions/f1b31.test.js`), backend **469**, os dois com zero skip e
zero todo. O backend continuou verde **sem ser alterado**, que era exatamente o
que a fase precisava provar.

---

## Emenda à DEC-046 e DEC-047 (F-1b.3.2, só frontend)

**O backend não foi tocado nesta fase.** Os dois registros ficam aqui porque o
log de decisões é **compartilhado e numerado em série** pelos dois repos: quem
procurar "DEC-047" a partir daqui precisa achar. A implementação está no
CLAUDE.md do frontend.

### Emenda à DEC-046 — o portal custa a ordem de tabulação

A DEC-046 pôs o painel do menu em `createPortal` no `body` para escapar do
`overflow` que o recortava. A validação manual (passo 178) achou o preço: **o
painel deixou de ser acessível por Tab, só por mouse**.

`createPortal` propaga **eventos** pela árvore do React, mas a **ordem de
tabulação é a do DOM real** — e no DOM real o painel é o último filho do
`body`, enquanto o gatilho está numa célula no meio da tabela. **Tirar o painel
do contêiner que recortava tirou junto a ordem de foco natural.**

O foco passou a ser **conduzido**: entra no primeiro item ao abrir (depois de a
posição estar calculada), circula dentro do painel com Tab e Shift+Tab, e volta
ao gatilho no Esc — que, com o Tab preso, é o único caminho de volta.

**Quem usar portal de novo herda este custo junto com a solução.**

### DEC-047 — a coluna de ações de toda listagem é o menu ⋮

O ⋮ existia só no Financeiro; Clientes, Processos, Documentos e Seções ainda
tinham a fileira de botões. A razão de padronizar não é estética: **a advogada
aprendia um gesto numa tela e ele não valia nas outras**.

Ação vai para dentro do menu; **explicação fica fora, na célula**; Excluir
sempre em vermelho e por último; **o componente é o mesmo, sem cópia**. Sete
listagens ao todo.

**Suítes na F-1b.3.2:** frontend **501** testes (22 novos em
`tests/regressions/f1b32.test.js`), backend **469**, os dois com zero skip e
zero todo. O backend continuou verde **sem ser alterado**.

---

## O ambiente de testes e o de desenvolvimento são REMOTOS (registrado na F-1b.3.2)

Dois fatos de infraestrutura que não estavam escritos em lugar nenhum e
custaram tempo numa sessão:

### `.env.test` aponta para Atlas, não para Mongo local

A suíte **não** precisa de `mongod` local — `.env.test` usa `mongodb+srv` e o
banco de teste é o **`lex_test` remoto**. A guarda que impede rodar sobre `lex`
continua valendo e não foi tocada.

**A consequência prática:** **duas sessões rodando a suíte ao mesmo tempo se
atropelam**, porque compartilham o mesmo `lex_test` remoto. Antes de rodar
`npm test` em paralelo com outra pessoa (ou com outro agente), combine — não há
isolamento por sessão.

**Como o atropelo APARECE** (medido na F-1c.1, duas vezes na mesma sessão): a
suíte quebra em dezenas de testes com **`401 — "Usuário do token não
encontrado"`**, e às vezes com **409 de duplicidade** em campos que o teste nem
tocou. A causa é o `limparColecoes` da outra execução apagando os usuários no
meio desta. **Não é regressão do código** — é a segunda suíte. O sintoma engana
porque as falhas caem em arquivos sem relação com o que se acabou de mexer
(numa das vezes, 43 falhas todas em `tests/documents/`).

Antes de investigar uma quebra assim, **confira que não há outra suíte
rodando**: `pgrep -f "node --test"`.

### `npm run seed:fresh` reseta um banco REMOTO e compartilhado

`reset:dev` + `seed:demo` rodam contra o banco de **desenvolvimento**, que é
**Atlas remoto** (`…/lex`), não um Mongo da máquina. **Só o banco de teste tem
guarda**; o de desenvolvimento não tem nenhuma.

É o comando documentado e é a pré-condição de quase todo passo do roteiro — mas
quem o roda está apagando o banco de desenvolvimento **de todo mundo**.
**Candidato a confirmação obrigatória quando o alvo não for local**, na linha
da guarda que o banco de teste já tem.

---

## DEC-048 — "Parcela 1 de 3": o número da parcela depois do reparcelamento (F-1c.1)

### O defeito

O reparcelamento (DEC-037) cancelava as parcelas em aberto e criava as novas
**continuando a numeração**. Um honorário de 2 parcelas que virava 3 ficava
com **1, 2** (canceladas) e **3, 4, 5** (vivas).

Para quem lê, **"parcela 3" de um plano de três é a PRIMEIRA**. A advogada, ao
telefone com o cliente, precisa dizer "são três parcelas, esta é a primeira" —
e a tela dizia 3.

### A decisão

1. **As parcelas novas renumeram a partir de 1.** O plano vigente é 1, 2, 3.
2. **As canceladas mantêm o número que tinham**, congelado, com "Reparcelada"
   ao lado. A história não é reescrita.
3. **O "de N" é congelado.** N é o tamanho do plano ao qual aquela parcela
   pertence — nunca recalculado. Uma parcela cancelada de um plano de 2
   continua dizendo "de 2", para sempre.

### Por que o campo é GRAVADO e não contado na leitura

Contar as parcelas do honorário no momento da leitura devolveria o total **de
todas as gerações somadas**. O número mudaria a cada reparcelamento, inclusive
nas parcelas antigas — e **um recibo emitido em maio passaria a dizer outra
coisa em setembro**.

**Recibo que muda de significado depois de entregue ao cliente é o defeito mais
grave que este projeto já corrigiu.** Congelado no nascimento é a única forma
que não reescreve o passado.

Foi exatamente esse o bug encontrado em `receiptService`: `totalDeParcelas` era
`countDocuments({feeId, ativo: true})`, a contagem de todas as gerações. O
recibo passou a usar o `totalParcelas` **da própria parcela**.

### Os dois campos, e a diferença que mais confunde

| Campo | Significa | Preenchido em |
|---|---|---|
| `reparcelamentoId` | a operação que me **CANCELOU** | só nas canceladas |
| `planoId` | a operação que me **CRIOU** | só da 2ª geração em diante (`null` = plano original) |

Uma parcela cancelada da 2ª geração tem os **dois** preenchidos, com valores
**diferentes**: nasceu no reparcelamento A e morreu no B. Um campo só não
conseguiria dizer isso — e foi por supor que `reparcelamentoId` queria dizer
"nasceu em" que a migração desta fase quase contou o conjunto errado.

`totalParcelas` é o "de N" congelado. É `null` **enquanto o plano está aberto**:
a advogada cria parcela por parcela (não há criação em lote), e quando a
primeira nasce ninguém sabe que serão três. Passa a ter valor, e aí nunca mais
muda, nos dois instantes em que o plano deixa de ser editável: quando o
reparcelamento **cria** as novas (M é conhecido) e quando **cancela** as
antigas (congela o N que elas tinham).

Enquanto é `null`, o rótulo conta o **plano vigente** na leitura — que é a
resposta verdadeira enquanto ele cresce. Os dois campos **não podem ser
enviados por rota**: `installmentService` recusa com 400, pela mesma razão do
`valorPago`.

### O índice único teve de mudar — era ele que impedia a decisão

Era `{feeId, numeroParcela}`, **único e não parcial**. Com ele, um honorário
não podia ter duas parcelas nº 1 — e o próprio `renegotiationService` dizia:
*"Recomeçar em 1 colidiria na primeira."*

Passou a ser **`{feeId, planoId, numeroParcela}`**: a unicidade vale **dentro
do plano**.

**A premissa da Fase 4.5 continua valendo**, e era o que este índice não podia
quebrar: ele segue **sem `partialFilterExpression`**, então a parcela
**desativada** (`ativo: false`) nunca solta o número dela — não existe segunda
parcela para colidir numa reativação. Um índice parcial em `ativo: true` teria
resolvido a DEC-048 e reaberto aquele buraco.

A checagem de duplicidade do serviço também passou a ser **por plano**: conferir
pelo honorário inteiro recusaria com 409 a criação de uma parcela válida no
plano vigente.

### O problema que a decisão cria, e como ele se resolve

Renumerar faz existirem **duas parcelas nº 1** no mesmo honorário: uma
cancelada e uma viva. Referenciar por ordinal passa a ser ambíguo — **é
exatamente o defeito que a DEC-045 resolveu para pagamentos.**

A solução é a mesma: **referência por atributo humano, não por ordinal.**

- viva: **"parcela 1 de 3, vencendo 15/09/2026"**
- cancelada: **"parcela 1 de 2, vencendo 10/05/2026 (reparcelada)"**

O **vencimento** distingue — duas parcelas nº 1 do mesmo honorário nunca vencem
no mesmo dia, porque a nova nasce de um plano futuro. O **"(reparcelada)"**
avisa que aquela linha pertence a uma história encerrada.

**Se a advogada precisar do id para saber de qual parcela a frase fala, a
DEC-048 falhou mesmo com a suíte verde.**

A frase sai de função pura, em `services/installmentReference.js` (backend) e
`components/financeiro/installmentLabel.js` (frontend) — as duas pontas montam
texto, e o que não pode haver é uma **terceira** cópia dentro de um componente.

**A referência do PAGAMENTO (DEC-045) não muda.** São duas referências
diferentes e elas convivem na mesma frase: *"Do pagamento de R$ 300,00 em
dinheiro (10/06/2026, #698600), aplicado na parcela 1 de 3, vencendo
15/09/2026."*

### A migração NÃO renumerou o passado

`scripts/migrarTotalParcelas.js` preencheu `planoId` e `totalParcelas` nas
parcelas já gravadas, e trocou o índice. **Não renumerou nada** — renumerar
dado gravado quebraria a referência de recibos já emitidos.

Um honorário reparcelado **antes** da F-1c.1 continua com 1, 2 (canceladas) e
3, 4, 5 (vivas), só que agora dizendo "de 2" e "de 3" corretamente. **A
renumeração vale só para reparcelamentos daqui em diante.**

O script é **idempotente** e derruba o índice velho explicitamente: o Mongoose
cria o novo na subida mas **não remove o antigo**, e sem essa parte o
reparcelamento continuaria falhando em produção com a suíte verde.

### Onde o rótulo aparece

Página do honorário, listagem de Parcelas, extrato, recibo, ficha do processo e
o cartão de próximos vencimentos do dashboard.

**O portal do cliente não entra** — e não por esquecimento: a **DEC-029 ponto
8** mantém o portal **sem nada financeiro**, com teste travando
(`tests/portal/isolamento.test.js`). Não há parcela para rotular lá, e se
aparecer número de parcela no portal **isso é o defeito**, não a melhoria.

A listagem de Parcelas atravessa honorários, então o "de N" efetivo dela vem
**calculado do backend** (`totalNoPlano`): contar a partir do array da página
daria o tamanho da PÁGINA, e o número mudaria a cada filtro.

---

## DEC-049 — a tela do reparcelamento (F-1c.2, só frontend)

**O backend não foi tocado nesta fase.** O registro fica aqui porque o log de
decisões é **compartilhado e numerado em série** pelos dois repos. A
implementação está no CLAUDE.md do frontend.

**O que mudou:** o botão "Reparcelar" da página do honorário, desabilitado desde
a F-1b, passou a levar a uma tela. O endpoint continua exatamente o mesmo —
`POST /api/fees/:id/renegotiations`, com `{ parcelas: [{valor, dataVencimento}],
motivo? }`, 422 quando a soma diverge do saldo.

**Rota dedicada, e não modal**, porque o plano novo tem N linhas editáveis e uma
soma corrente que precisa ficar visível o tempo todo — num modal ela sai da tela
justamente quando há mais linhas para conferir.

**O contrato do backend não precisou de nada novo.** A tela deriva tudo de
`GET /fees/:id`: o saldo de `totais.emAberto` (a mesma fórmula que
`saldoEmAberto` usa para validar, DEC-040) e as listas do que sai e do que fica
de `parcelas[]`, pela mesma regra do `renegotiationService` — sai o que não está
`pago` nem `cancelado`.

**Suítes na F-1c.2:** frontend **546** testes (31 novos em
`tests/regressions/f1c2.test.js`), backend **486**, os dois com zero skip e zero
todo. O backend continuou verde **sem ser alterado**.

**Suítes na F-2a:** backend **508** testes (22 novos: 13 em
`tests/auth/semantica401.test.js`, 9 em `tests/financial/planoDeParcelas.test.js`),
frontend **566** (20 novos em `tests/regressions/f2a.test.js`). Zero skip, zero
todo nos dois.

**Suítes na F-2b:** backend **549** testes, **+41** sobre os 508 da F-2a — 15 em
`tests/processClient/dec052.test.js`, 12 em `tests/infra/rateLimit.test.js` e 14
em `tests/infra/guardaDeBanco.test.js`. Frontend **583**, +17 em
`tests/regressions/dec052.test.js`. Zero skip, zero todo nos dois.

## DEC-050 — a semântica do 401 (F-2a)

**A regra, em uma frase:** *o 401 é reservado **exclusivamente** para sessão
ausente ou inválida. Qualquer outra falha de credencial dentro de uma sessão
válida é **422**.*

**O defeito (V-2).** Errar a **senha atual** em `POST /auth/alterar-senha`
devolvia 401. O interceptor do axios trata todo 401 como sessão perdida e
**deslogava a advogada** — ela errava a digitação e era expulsa do sistema.

**A causa é semântica, não de interceptor.** O 401 respondia a duas perguntas
diferentes: *"não sei quem você é"* e *"sei quem você é, e este dado que você me
mandou está errado"*. Só a primeira justifica descartar a sessão.

**Por que não uma lista de exceção de rotas no frontend.** Ela resolveria este
caso e apodreceria no próximo: a rota seguinte que devolvesse 401 por engano não
estaria nela, e o defeito voltaria calado, num lugar diferente. A regra
semântica não tem esse problema — e com ela o interceptor fica trivialmente
correto: desloga em 401 e **não precisa conhecer rota nenhuma**.

### O inventário completo dos 401 do backend, classificado

**Categoria 1 — sessão ausente ou inválida. CONTINUA 401.**

*Por arquivo e função, não por linha: linha em documento vivo apodrece — este
CLAUDE.md já carregou uma referência `axiosConfig.js:14-26` que deixou de existir.
O levantamento com as linhas exatas do dia está no relatório da F-2a.*

| Onde | O que significa |
|---|---|
| `middleware/authMiddleware.js` — `authMiddleware` | token não informado |
| idem | token do PORTAL apresentado na área da advogada (2ª tranca do isolamento) |
| idem | usuário do token não existe mais |
| idem | token malformado, expirado ou com assinatura que não confere (`catch`) |
| `services/authService.js` — `loginUser` | `POST /auth/login`: e-mail inexistente |
| idem | `POST /auth/login`: senha errada |
| `services/portalAuthService.js` — `credenciaisInvalidas` | `POST /portal/login`: o 401 unificado da DEC-029 ponto 11 |
| `services/portalAuthService.js` — `trocarSenha` | `PATCH /portal/senha`: cliente inexistente ou inativo — a sessão perdeu o sujeito |
| `services/portalAuthService.js` — `reemitirSessao` | vínculo inexistente |
| `middleware/portalAuthMiddleware.js` — `sessaoInvalida` | sessão do portal ausente, expirada ou inválida |

**As rotas de LOGIN continuam 401 de propósito.** Ali não há sessão — é o pedido
para criar uma —, e "não sei quem você é" é literalmente a resposta certa. O
interceptor não desloga ninguém por elas porque **não havia sessão a perder**;
ver a nota sobre `sessionLoss.js` no CLAUDE.md do frontend.

**Categoria 2 — credencial conferida dentro de sessão válida. PASSOU A 422.**

| Onde | Rota | O que significa | Era |
|---|---|---|---|
| `services/authService.js` — `changePassword` | `POST /auth/alterar-senha` | senha atual errada, sessão válida | **401** — o defeito V-2 |
| `services/portalAuthService.js` — `trocarSenha` | `PATCH /portal/senha` | senha atual errada, sessão válida | **400** |

**O 400 do portal entrou por consistência, não por defeito.** Ele não causava o
V-2 (o interceptor do portal só reage a 401 com `sessaoPortalInvalida`). Mas é a
**mesma pergunta** respondida com dois números diferentes, e isso é o que faz a
próxima pessoa copiar o que vir primeiro.

**422 e não 400** nos dois: o corpo está bem formado e os campos são válidos; o
que falha é a **conferência** do valor contra o que está gravado. É a mesma
leitura que o módulo de documentos dá ao 422 desde a Fase 4.6.

**Onde a regra está escrita no código:** no cabeçalho de
`middleware/authMiddleware.js`, que é a única origem legítima de 401 na área da
advogada — se um 401 novo aparecer, tem de vir de lá.

**O inventário é executável:** `tests/auth/semantica401.test.js` tem um teste
por linha das duas tabelas, mais uma varredura que falha se qualquer rota
autenticada responder 401 com sessão válida.

## DEC-051 — a ordenação das parcelas por geração (F-2a, só frontend)

**O backend não foi tocado por esta decisão.** O registro fica aqui porque o log
é **compartilhado e numerado em série** pelos dois repos; a implementação está no
CLAUDE.md do frontend.

**O defeito:** na página do honorário as parcelas vinham ordenadas por número.
Depois da DEC-048, que faz cada plano numerar a partir de 1, três gerações se
**intercalavam** — `1 de 2` (morta), `1 de 3` (morta), `1 de 2` (viva),
`2 de 2` (morta)… e a advogada tinha de **caçar quais valem**.

**A regra:** agrupar por plano — **o plano vigente primeiro**, em ordem
numérica; os planos substituídos depois, também em ordem numérica, cada grupo
com um separador ("Substituídas pelo reparcelamento de 21/08/2026").

**O motivo:** a pergunta que a tela responde é *"quanto ainda se deve, e
quando"*. O histórico responde outra pergunta e não pode disputar espaço com a
primeira.

**Não apaga nada** — as canceladas continuam visíveis, com o rótulo congelado e
o badge "Reparcelada", como a DEC-048 exige.

**O que o backend fornece, e já fornecia:** `GET /fees/:id` devolve `planoId`
(quem me criou), `reparcelamentoId` (quem me cancelou) e `reparceladaEm`. Os
três bastam — nenhum endpoint mudou.

**A sutileza que a regra precisou tratar:** um plano de 3 com a primeira parcela
já **paga** cancela só as outras duas, e a paga continua de pé **no plano
velho**. Por isso é o **grupo** que é "substituído", não a parcela: o separador
diz o que aconteceu com o plano, e o badge de cada linha continua dizendo o que
aconteceu com ela.

## O seed grava o plano inteiro — a migração deixou de ser pré-condição (F-2a)

**O remendo que saiu.** `npm run seed:fresh` criava as parcelas uma a uma por
`criarInstallment`, que deixa `totalParcelas` em `null` **de propósito** — a
advogada cria parcela por parcela pela interface, e quando a primeira nasce
ninguém sabe que serão três. Só que o **seed sabe**: ele tem o array literal do
plano. O resultado de gravar incompleto foi que
`node scripts/migrarTotalParcelas.js` virou **pré-condição de todo reset**, e o
roteiro de validação repetia as duas linhas em **seis passos**.

**`criarPlanoDeParcelas(usuarioId, feeId, parcelas[])`**
(`services/installmentService.js`) é o **terceiro instante** em que o tamanho do
plano é conhecido de verdade — os outros dois são a criação e o cancelamento de
um plano pelo `renegotiationService` (DEC-048). Ela cria cada parcela pelo
caminho normal (validação, duplicidade, **auto-alocação do saldo adiantado** e
recálculo) e só no fim carimba `totalParcelas` no plano, com o mesmo
`updateMany` idempotente do cancelamento.

**O seed usa o SERVIÇO e não escreve no model.** Dois lugares que sabem criar
parcela divergem, e o que se perde na divergência é a auto-alocação da DEC-036,
que dispara no nascimento da parcela e é metade do que o cenário de demonstração
existe para mostrar. Há teste travando isso.

**`scripts/migrarTotalParcelas.js` CONTINUA no repositório, e continua
necessário.** Ele existe para dados gravados **antes da DEC-048** e é obrigatório
em qualquer banco que não tenha sido semeado do zero. Ele também **troca o
índice único** (`{feeId, numeroParcela}` → `{feeId, planoId, numeroParcela}`),
coisa que o `seed:fresh` só dispensa porque `resetDev.js` faz `dropCollection` e
o Mongoose recria o índice novo na subida. **Não apagar.** O que ele deixou de
ser é remendo de um seed que gravava incompleto.

## DEC-052 — a cascata registra o que derrubou (F-2b)

**A regra, em uma frase:** *a desativação em cascata **marca** cada vínculo que
derrubou; a reativação restaura **exatamente esses** e limpa a marca.*

### O achado que a F-2a levantou e não resolveu

`deleteProcess` desativa o processo **e**, na mesma transação, chama
`desativarVinculosDoProcesso`. A cascata existe por um bom motivo: vínculo ativo
apontando para processo inativo faria o cliente **parecer ocupado**, e o
`DELETE /clients/:id` recusaria a exclusão por um processo que já não existe.

**O problema era que ela não registrava o que fazia.** Remover um participante
individualmente (`desvincularCliente`, pelo
`DELETE /processes/:id/clientes/:clienteId`) gravava **exatamente o mesmo**
`ativo: false` no mesmo campo do mesmo documento. Depois do fato, **nada
distinguia os dois** — e reativar não tinha saída correta:

| Opção | O que quebra |
|---|---|
| restaurar **todos** os inativos | ressuscita participantes que a advogada **removeu de propósito** |
| restaurar **nenhum** | processo volta **vazio** — estado que o próprio sistema declara impossível, com `clientePrincipalId` (`required`) apontando para vínculo morto e a geração de documento falhando em 422 |

Não havia terceira saída sem tocar na desativação. Foi por isso que a Parte 4 da
F-2a parou.

### É a TERCEIRA vez que este projeto chega à mesma conclusão

> **Estado passado não se infere, se registra.**

| Onde | O que se registrou em vez de inferir |
|---|---|
| **Estorno** (F-1a) | a alocação desfeita **guarda** que foi desfeita, em vez de ser recalculada a partir do saldo |
| **DEC-044** | a linha do extrato que deixou de valer **diz** que deixou, em vez de a tela deduzir pela ausência |
| **DEC-052** (agora) | a cascata **marca** o que derrubou, em vez de a reativação adivinhar depois |

**Inferência sobre estado passado é o que produziu o pior defeito deste
projeto.** Quem chegar aqui uma quarta vez: a resposta já é conhecida — grave o
fato no momento em que ele acontece.

### O campo

`ProcessoCliente.desativadoPorCascataDe` — o id do processo que derrubou o
vínculo. **Um campo, três leituras:**

```
preenchido        → caiu pela cascata do processo X (e diz qual)
null + inativo    → foi removido À MÃO
null + ativo      → vínculo comum, em uso
```

**Guardar o id, e não um booleano**, é redundante com `processoId` *hoje* — e é
de propósito: o dia em que outra coisa cascatear para cá, um booleano não saberia
dizer QUEM derrubou, e voltaríamos a inferir.

**A marca é limpa na reativação.** Sem a limpeza, uma remoção manual posterior
do mesmo vínculo carregaria marca de cascata velha e ele voltaria sozinho na
reativação seguinte. `desvincularCliente` também zera a marca — rede de
segurança, e há teste travando a **invariante**: *nenhum vínculo ATIVO carrega
marca de cascata*.

**As duas escritas são transacionais** com a do processo, nas duas direções:
cascata pela metade é pior que cascata nenhuma. Há teste que força a escrita dos
vínculos a falhar e confere que o processo continua **ativo** e sem histórico.

### O que a reativação NÃO faz

> ⚠️ **Leia a DEC-053 junto com esta seção.** A DEC-052 governa a **descida**
> (o pai não arrasta o filho de volta); a **DEC-053** governa a **subida** (o
> filho não sobe sem o pai). **São a mesma regra vista dos dois lados** — e
> escrever só esta metade foi o que deixou o órfão passar pela F-2b. Quem mexer
> numa precisa ler a outra.

**Não cascateia para cima.** Reativar um processo não reativa o cliente dele;
reativar um cliente não reativa os processos. Cada registro se reativa por si, e
**a tela diz isso antes de confirmar** — sem a frase, a advogada reativa o
cliente e presume que voltou tudo.

**Mas reativar o filho sozinho não é livre**: desde a **DEC-053**, reativar um
processo cujo cliente está desativado é **recusado**, nomeando o cliente. "Cada
registro se reativa por si" continua valendo — na **ordem** certa: o pai
primeiro.

No cliente a ausência de cascata é estrutural, não esquecimento: `deleteClient`
só aceita desativar quem **não participa de nenhum processo ativo**. No momento
em que ele saiu não havia processo dele de pé para derrubar, e não há o que
ressuscitar na volta.

### Três coisas que a reativação exigiu para existir de fato

**1. `historicoAtivacao` em `Process` e `Client`.** Os dois models não tinham
histórico nenhum — o único do sistema era `Fee.historicoStatus`. Append-only,
schema compartilhado (`models/shared/historicoAtivacaoSchema.js`), fora da
allowlist de update. Guarda `acao`, `data` e `vinculosAfetados` (`null` no
cliente, que não cascateia — e `null` diz "a pergunta não se aplica", enquanto
`0` diria "cascateou e não pegou ninguém").

**Não é o histórico de STATUS que a F-2c vai trazer**, e ficam separados de
propósito: status é o andamento jurídico ("em recurso", "arquivado"), ativação é
se o registro existe para o sistema. Um processo arquivado continua **ativo**.

**2. O filtro `situacao` nas listagens.** `getAllClients` e `listProcesses`
filtravam `ativo: true` **sem alternativa** — um registro desativado não
aparecia em lugar nenhum, e a reativação era **impossível pela interface**.
Três valores (`ativos` — o padrão, inalterado —, `inativos`, `todos`); valor
desconhecido é **400 com `campo`**, porque `?situacao=ativas` devolveria os
ativos em silêncio e a advogada concluiria que não há desativados.

**3. As rotas.** `PATCH /clients/:id/reactivate` e
`PATCH /processes/:id/reactivate`, mais `GET /processes/:id/activation-preview`
(a contagem que a tela mostra antes de confirmar). **Sub-rota própria, e não
`PATCH /:id { ativo: true }`**: `ativo` está fora da allowlist de update desde a
Fase 4.5 (achados #1/#2/#11), e reabri-lo devolveria a porta que a auditoria
fechou — a de desativar um registro por um PATCH comum, sem passar pela checagem
de dependências.

Reativar o que já está ativo é **404**, não 200 silencioso: significa que a tela
ofereceu uma ação que não existia, e esconder isso atrasaria o diagnóstico.

## DEC-053 — nada fica ativo debaixo de coisa inativa (F-2c)

**A regra, em uma frase:** *nenhum registro pode estar **ativo** enquanto o pai
dele estiver **inativo** — nem subindo (reativar), nem nascendo (criar).*

### O achado

A validação da F-2b (22/08/2026, passo 197) conseguiu **reativar um processo
cujo cliente estava desativado**. O estado que isso cria é um **órfão visível**:
o processo volta às listagens, o cliente não, e quem clicar no nome do cliente
cai num registro que o sistema trata como arquivado.

O caminho que produz o órfão é o caminho normal, e é por isso que ele passou:

1. desativa o **processo** — a cascata da DEC-052 derruba os vínculos;
2. desativa o **cliente** — agora permitido, porque ele não participa mais de
   processo ativo nenhum (é a guarda de `deleteClient`);
3. reativa o **processo** — e nada perguntava pelo cliente.

### Por que a F-2b não pegou: a regra existia numa direção só

A **DEC-052** decidiu que reativar o **pai** não reativa os **filhos** — para
não ressuscitar o que foi removido de propósito. Está correto e continua
valendo. Mas **nada foi dito sobre o caminho inverso**: a cascata sabia o que
derrubou, e nada impedia um filho de subir sozinho.

| | Direção | O que garante |
|---|---|---|
| **DEC-052** | a **descida** | o pai não arrasta o filho de volta |
| **DEC-053** | a **subida** | o filho não sobe sem o pai |

> **São a mesma regra vista dos dois lados. Quem mexer numa precisa ler a
> outra.** Uma sem a outra deixa metade da porta aberta, e foi exatamente essa
> metade que produziu o órfão.

### Por que a regra é GERAL, e não "Processo→Cliente"

O caso achado era **instância de um princípio**, não um defeito isolado.
Escrever só o caso teria deixado as outras portas abertas — e a segunda porta
não é hipotética: **criar um honorário novo num processo arquivado faz o órfão
NASCER em vez de ressuscitar**. É a mesma falha, pela outra boca.

Por isso a regra tem **duas bocas**, e as duas são fechadas:

| Boca | Ação | Resposta |
|---|---|---|
| **1** | reativar registro cujo pai está inativo | **409**, nomeando o pai |
| **2** | criar registro sob pai inativo | **409**, nomeando o pai |

### A ÁRVORE DE RELAÇÕES — levantada dos models, não presumida

Vive em `src/services/activationHierarchy.js` (`ARVORE_DE_ATIVACAO`), que é o
ponto único da regra. Só entram relações em que **pai e filho têm, os dois,
soft delete de verdade**.

| Filho | Pai(s) | Observação |
|---|---|---|
| `Client` | `User` | o pai é o **tenant** — ver abaixo |
| `Process` | `Client` | pelo `clientePrincipalId` **e** por todo vínculo que a cascata restauraria. **É esta relação que produziu o órfão** |
| `ProcessoCliente` | `Process`, `Client` | dois pais; é a própria aresta |
| `Fee` | `Process` | **`Fee` NÃO tem `clienteId`** — conferido no model. O cliente só alcança o honorário através do processo |
| `Installment` | `Fee`, `Process` | `processoId` é desnormalizado; `feeId` é o pai de verdade |
| `Payment` | `Fee`, `Process` | `ativo` existe por uniformidade; nenhuma rota o escreve |
| `Document` | `Process`, `Client`, `Fee` | `clienteId` e `feeId` são opcionais conforme o tipo |
| `Secao` | `User` | biblioteca da advogada; pai é o tenant |
| `DocumentoSecao` | `Document`, `Secao` | dois pais; junção documento↔seção |

**Fora da árvore, e a ausência é deliberada:**

| Model | Por que não entra |
|---|---|
| `Reversal` | **não tem `ativo`**. "Estorno que não vale mais" é um segundo estorno com `estornoAnuladoId` |
| `Allocation` | não tem `ativo`. Sai de cena por `estornoId` |
| `Renegotiation` | não tem `ativo` |
| `ConfirmacaoVisualizacao` | tem `ativo` por convenção, mas **nenhuma rota o escreve** — é registro probatório, imutável por projeto |

**O tenant não entra na regra, e isso é decisão.** `User.ativo` existe, mas
nenhuma rota o escreve e o `authMiddleware` não filtra por ele: usuário inativo
é hoje um estado que só existe se alguém editar o banco à mão. Uma guarda contra
um estado inalcançável é código que nunca roda e que ninguém consegue testar sem
fabricar o estado por fora. **Quando existir desativação de usuário, esta é a
linha que vira guarda** — e a árvore acima mantém a relação no mapa até lá.

### A recusa NOMEIA o pai

> *"Não é possível reativar: o cliente **Beatriz Ramos Pereira** está
> desativado. Reative o cliente primeiro."*

**Recusar em silêncio é pior que permitir.** Uma mensagem genérica manda a
advogada procurar, num cadastro de trezentos clientes, qual deles está fora. A
frase diz **qual** pai, **pelo nome**, e **o que fazer**.

O nome sai de um ponto único (`nomeDoCliente`): PF guarda em `nomeCompleto`, PJ
em `razaoSocial`. Sem ele, metade das recusas sairia nomeando "(sem nome)" —
justamente no caso em que o nome mais importa para achar o cadastro.

**O erro:** 409, `regra: "paiInativo"` (`REGRA_CONFLITO.PAI_INATIVO`), com os
bloqueadores em `errors.paisInativos: [{ tipo, id, nome }]`. Vão dentro de
`errors` — que o `errorHandler` já repassa inteiro — e **não** em chave solta:
é o que impede a allowlist de `CHAVES_ESTRUTURADAS` de crescer uma linha por
regra.

### Quais clientes bloqueiam a reativação de um processo

Não basta `clientePrincipalId`: um cliente pode ser **litisconsorte** sem nunca
ser principal, e reativar o processo restauraria o vínculo dele — o mesmo órfão,
uma camada abaixo, onde ninguém procura. É a mesma razão pela qual
`deleteClient` olha a **junção**, e não o campo do processo.

O conjunto é: **o principal** + **todo cliente cujo vínculo a cascata da DEC-052
restauraria** (`desativadoPorCascataDe: processoId`).

**Vínculo removido À MÃO fica de fora.** Ele **não volta** na reativação — é o
ponto inteiro da DEC-052 —, então o estado do cliente dele não importa aqui.
Incluí-lo recusaria a reativação por causa de alguém que continuaria
desvinculado. **É a fronteira exata entre as duas decisões, e há teste para
ela.**

### A boca 2 já era recusa — o que mudou foi a MENSAGEM

Todo `findOne` de pai no projeto sempre filtrou `ativo: true`. O levantamento da
F-2c confirmou a recusa em `createProcess`, `createFee`, `createInstallment`,
`createPayment`, `vincularCliente` e `vincularSecao` — **e isso já era assim**.

O que mudou é que "não encontrado" virou "está desativado", com o nome:

| Situação | Antes | Agora |
|---|---|---|
| pai **inexistente** | 404 / 400 | **igual** — e continua sem confirmar existência de registro alheio |
| pai **desativado** | 404 "não encontrado" | **409 nomeando o pai** |

**Um 404 "Processo não encontrado" para um processo que a advogada está vendo na
tela com a tag "Desativado" manda procurar o que não está perdido.**

Há uma **terceira porta**, fechada junto: `PATCH /fees/:id` com `processoId`
**movendo** um honorário para um processo desativado. O honorário continuaria
ativo, agora sob pai inativo.

**Uma exceção documentada e não corrigida:** vincular cliente a processo
desativado responde **404**, não 409. `assertProcessoDoUsuario` é a mesma guarda
que serve as **leituras** de participante, e um processo desativado é
inalcançável por essa rota inteira. Mudar isso mudaria o 404 de toda leitura de
participante — e não é o que a F-2c foi fazer.

### A autoridade é do SERVIÇO

A listagem (`impedimentosDeReativacao`) e o `activation-preview` carregam quem
bloqueia, para a tela desabilitar "Reativar" com o motivo ao lado. **Isso é
conveniência.** `reactivateProcess` recusa de qualquer forma — inclusive para
quem chamar a rota direto, sem passar por tela nenhuma —, e **há teste que
chama o serviço direto** para provar exatamente isso.

Na listagem, `impedimentosDeReativacao` **só existe na linha desativada**: num
processo ativo a pergunta não se aplica. No `activation-preview` do desativado
ele vem **sempre, mesmo vazio** — ali a tela PERGUNTOU se pode reativar, e vetor
vazio é a resposta "pode"; omitir a chave obrigaria o frontend a distinguir "não
perguntei" de "perguntei e não há".

São **duas consultas por página**, não duas por linha: a tela que mais mostra
desativado é justamente a filtrada por "Somente desativados".

### Os órfãos que já existem — `scripts/auditarOrfaos.js`

`npm run auditar:orfaos` percorre a árvore e **relata** todo registro ativo sob
pai inativo, com **pai e filho nomeados**.

**Ele não conserta, e isso é decisão.** Corrigir automaticamente significaria
escolher, sem saber, entre **desativar o filho** (esconde um processo que talvez
esteja em andamento) e **reativar o pai** (ressuscita um cadastro que talvez
tenha saído de propósito). **Essa escolha é da advogada** — e cada correção
feita pela tela fica no `historicoAtivacao`, que uma correção em massa por
script não deixaria.

> **O script NÃO é destrutivo, e por isso NÃO leva a guarda de banco da F-2b.**
> Está escrito no alto do arquivo, em voz alta, porque todo script novo em
> `scripts/` provoca a pergunta "cadê a guarda?".
>
> Guarda de comando destrutivo em comando que não destrói **treina a advogada a
> digitar o nome do banco para rodar um relatório** — e o dia em que digitar
> `lex` virar reflexo é o dia em que a guarda dos scripts que de fato apagam
> deixa de proteger.
>
> `mongoose.set("autoIndex", false)` está lá para que "só lê" seja
> **literalmente** verdade: o Mongoose constrói índices na compilação dos
> models, e construir índice é escrita.
>
> **No minuto em que ele ganhar uma escrita, ele ganha a guarda junto.** Não
> existe meio-termo. Há teste que varre o arquivo por `updateOne`, `deleteMany`,
> `.save(` e companhia, e que compara o banco **documento por documento** antes
> e depois — contagem não bastaria: uma "correção" silenciosa viraria `ativo`
> sem mudar contagem nenhuma.

Um processo desativado sob cliente desativado aparece **duas vezes** no
relatório: `Processo → Cliente (principal)` e `Vínculo processo-cliente →
Cliente`. São dois registros ativos sob o mesmo pai inativo — e é a segunda, a
que não vem à cabeça, que a auditoria existe para achar.

---

## Passos 90–98 (portal) — o levantamento da F-2c

**Conclusão, antes do detalhe: eles NÃO são "controles de acesso do portal por
implementar". São passos de VALIDAÇÃO MANUAL de funcionalidade que já existe,
entregue na Fase 3.2 — e nunca executados.**

A pendência vinha sendo carregada fase após fase com a marca *"antes de qualquer
cliente real usar o portal"*, e a redação foi endurecendo até parecer trabalho
de código não feito. O levantamento da F-2c leu os nove passos e confrontou cada
um com o código. **Nenhum deles descreve controle de acesso ausente.**

### O que cada um exige, e onde ele está

| # | O que o passo exige | Marca | Veredito | Onde |
|---|---|---|---|---|
| **90** | PDF e DOCX baixam com nome do servidor, abrem no aparelho | `[só olho humano]` | **atendida** (código) | `portalController.js:76` (`Content-Disposition`), `documentRenderService.js:75` (`montarNomeArquivo`) |
| **91** | Confirmação **depois** do conteúdo, sem modal; declaração inteira; recibo em fuso de Brasília | `[só olho humano]` | **atendida** (código) | `PortalProcessPage.jsx:176` (bloco por último), `portalLabels.js:91` (`America/Sao_Paulo`) |
| **92** | Confirmar de novo **não apaga** a anterior; as duas aparecem | `[automatizável]` | **atendida + automatizada** | `PortalConfirmation.jsx:99,159`; `tests/portal/confirmacao.test.js:238` |
| **93** | Botão "Sair" visível na barra; *voltar* não devolve a sessão | `[só olho humano]` | **atendida** (código) | `PortalLayout.jsx:34` |
| **94** | Definir/entregar/redefinir/revogar senha; senha **nunca** exibida; mensagem pronta **sem** a senha; CPF recusado com mensagem própria | `[automatizável]` | **atendida + automatizada** | `AccessDelivery.jsx:109`; `clientValidation.js:63–71` (CPF/CNPJ); `tests/portal/auth.test.js:338` |
| **95** | O código cabe numa ligação — legibilidade ao ditar | `[só olho humano]` | **inverificável por código** | `utils/accessCode.js` |
| **96** | Selos "Confirmou a leitura" × "Acessou, não confirmou" | `[automatizável]` | **atendida**; automatizada **só no backend** | `portalEstados.js:23`; `statusVisual.js:98–99`. **Sem teste de frontend para os selos** |
| **97** | Contador do dashboard zera ao **olhar a lista**, não ao abrir o processo | `[automatizável]` | **atendida + automatizada** | `ProcessDetailPage.jsx:103,254`; `tests/portal/confirmacao.test.js:352` |
| **98** | Aviso de visibilidade nas **duas** regerações, com textos **diferentes** | `[só olho humano]` | **atendida + automatizada** | `GenerationPanel.jsx:291,324`; `tests/documents/regeracao.test.js:126–163` |

### O controle de acesso propriamente dito — já existe, e é testado

A dimensão que a redação da pendência sugeria (*"um cliente ver dado de
outro"*) **não está nesses nove passos**, e está implementada e coberta:

- `portalAuthMiddleware.js:58–90` — **o vínculo é revalidado a cada
  requisição**, nunca confiado ao token: cliente, processo e vínculo precisam
  estar **ativos**, o token precisa **coerir** com o vínculo no banco, e o
  carimbo da senha invalida sessões anteriores. Revogar acesso tem efeito
  **imediato**, sem esperar as 2 h da sessão;
- `tests/portal/isolamento.test.js` — token de portal não vale em rota da
  advogada e vice-versa; a sessão de um vínculo não alcança outro; o código do
  cliente A nunca devolve o processo do cliente B; a senha de um cliente não
  abre o código de outro; varredura de `senhaPortalHash`, `codigoAcesso`,
  `usuarioId`; e um **placar explícito de "zero vazamentos"**.

### O que a F-2c NÃO fez, e por quê

**Nenhuma linha de código.** Não havia exigência desatendida para implementar:
cinco dos nove são `[só olho humano]` por definição — *"nenhum script abre um
DOCX no Word do Android para ver se corrompeu"* —, e os quatro `[automatizável]`
já têm código **e** cobertura.

**A única lacuna real encontrada:** o passo **96** (selos de litisconsórcio) tem
o vocabulário travado no backend e os rótulos em `statusVisual.js`, mas **não
tem teste de frontend** provando que a tela do processo os exibe. É pequeno, é
verificável, e fica registrado aqui em vez de virar código numa fase cujo portão
de escopo já tinha sido gasto na Parte 1.

> **A pendência continua aberta — como VALIDAÇÃO, que é o que ela sempre foi.**
> Os nove passos precisam do Daniel, num celular de verdade, antes de qualquer
> cliente real usar o portal. Nenhuma fase de código os fecha.

---

## Rate limit — os tetos por ambiente (F-2b)

**O passo 85 nunca foi código a escrever.** Ele é **pré-voo**: conferir que a
demonstração não está rodando com `NODE_ENV=production`. O teto por ambiente já
existia desde a auditoria, e o passo foi validado em 17/08/2026. Lido o código
na F-2b, o comportamento anterior **não estava** nem atrapalhando o
desenvolvimento nem desligado onde deveria valer.

Duas coisas reais apareceram na leitura, e as duas foram feitas:

**1. Uma cópia só.** O bloco inteiro — multiplicador, `ehProducao`,
`inteiroPositivo`, a janela — estava **duplicado** em `authRoutes.js` e
`portalRoutes.js`, linha por linha. Foi para `src/config/rateLimit.js`. Duas
cópias da mesma decisão divergem: bastaria ajustar uma para o portal e a área da
advogada passarem a se comportar diferente sem ninguém notar.

**2. `test` deixou de ser tratado como `development`.**

| Ambiente | Fator | Teto de cadastro (default 5) |
|---|---|---|
| `production` | **1×** | **5** — o limite de verdade |
| `development` | **20×** | 100 |
| `test` | **500×** | 2500 |
| desconhecido | 20× (cai no de dev) | 100 |

Os dois primeiros já eram assim. O terceiro é novo, e a conta que o motivou: a
suíte faz **mais de 60 cadastros** numa execução de ~6 minutos — ou seja, dentro
de **uma única janela de 15**. Com o fator de dev, o teto era 100: margem de um
terço, e ela encolhe a cada fase (486 → 549 testes entre a F-1c.2 e a F-2b). No
dia em que estourasse, a falha **não diria "rate limit"** — apareceria como um
cadastro recusado num teste que não tem nada a ver com autenticação.

**500 e não `Infinity`:** um número mantém o limitador montado, exercitando o
mesmo caminho de código que roda em produção. Desligá-lo faria a suíte deixar de
cobrir o middleware inteiro.

**Ambiente desconhecido cai no fator de DESENVOLVIMENTO, nunca no de produção** —
errar para o lado seguro: um `NODE_ENV=staging` no teto de produção derrubaria
uma demonstração.

**`RATE_LIMIT_MULTIPLICADOR` sobrepõe o fator.** Existe para quem precisa de um
teto exercitável sem declarar `NODE_ENV=production` — é o caso da sonda que
estoura o balde do portal (`tests/portal/fixtures/rateLimitProbe.mjs`) para
provar que ele é independente dos baldes da advogada. Declarar produção ali
arrastaria o `errorHandler` e o resto do sistema junto.

**Os defaults de produção NÃO mudaram** e não devem ser baixados: 5 cadastros,
10 logins, 5 trocas de senha, 5 acessos ao portal, por 15 minutos.

## Guarda dos comandos destrutivos (F-2b)

`npm run seed:fresh` derruba **treze coleções**; `migrarTotalParcelas.js`
reescreve parcelas e **troca um índice único**; `seed:demo:clean` apaga tudo do
usuário demo. Os três rodam contra o banco de **desenvolvimento**, que neste
projeto é **Atlas remoto e compartilhado** — não um Mongo local descartável.

Só o banco de **teste** tinha guarda (`tests/helpers/env.js`). O de
desenvolvimento não tinha nenhuma, e **já aconteceu de um `seed:fresh` apagar
dados no meio de uma validação**.

**Aviso que não interrompe é aviso que ninguém lê.** Os scripts já imprimiam o
banco em que estavam mexendo, e isso não impediu o acidente: a saída rola, o
comando já está rodando, e quando a linha aparece o dano está feito. A guarda
(`scripts/lib/guardaDeBanco.js`) **INTERROMPE**.

**Confirma-se digitando o NOME DO BANCO**, não "s/n". "y" é memória muscular:
quem roda `seed:fresh` seis vezes num dia responde "y" sem ler. Digitar `lex`
obriga a olhar **qual** banco está no alvo — e é exatamente esse o erro que a
guarda existe para pegar.

| Situação | O que acontece |
|---|---|
| banco **local** (`localhost`, `127.0.0.1`, `::1`) | passa direto, **sem perguntar** — perguntar num banco descartável treinaria a resposta automática |
| banco **remoto**, terminal interativo | interrompe e exige o nome digitado |
| banco remoto, **sem TTY** | **RECUSA** — um script encadeado rodaria a operação sem ninguém ter visto a pergunta |
| `LEX_CONFIRMA_BANCO=sim` ou `--sim`/`--yes`/`-y` | dispensa, de propósito |
| conjunto **misto** de hosts | tratado como remoto: basta um nó fora da máquina |
| URI vazia ou torta | **não** é considerada local — o que não se classifica, pergunta |

**A URI nunca aparece na saída, nem mascarada** — ela carrega usuário e senha do
cluster. O que se imprime é o **nome do banco**, que é o que a pessoa precisa
para decidir. O host do cluster saiu do log de `resetDev.js` pelo mesmo motivo.

**`--dry-run` da migração não pergunta**: é justamente o modo que existe para
olhar antes de agir. **O seed comum também não** — `seed:fresh` é
`reset:dev && seed:demo`, e o reset já perguntou; perguntar duas vezes na mesma
execução treina a resposta automática. Só o `--clean` tem guarda própria, porque
é chamado sozinho.

## O que fica para adiante (atualizado em 22/08/2026 — depois da F-2b)

**Saíram da lista da F-1b.3 porque a F-1b.2 os fez:** o badge "estornado
integralmente", a coluna de honorário legível e **moeda que nunca trunca** —
esta última agora vale nas sete listagens, com teste que falha se qualquer
célula juntar `cell-num` e `cell-truncate`.

**✅ F-1c — FEITA, nas duas metades.** A F-1c.1 trouxe a **DEC-048** ("Parcela 1
de 3": o plano vigente renumera, o "de N" é congelado por `planoId`); a F-1c.2
trouxe a **DEC-049** — a tela do reparcelamento, em **rota dedicada** e não
modal, porque o plano tem N linhas e uma soma corrente que precisa ficar
visível. O botão desabilitado da página do honorário **ligou**.

**O ciclo Financeiro 2.0 fecha aqui**, da DEC-032 à DEC-049. A seção **28** do
roteiro do frontend é a travessia de encerramento: honorário vazio → parcelas →
pagamento → alocação → estorno → anulação → reparcelamento → recibo → extrato,
numa sentada só, provando que **os números fecham entre si** depois da cadeia —
que é o que nenhum passo isolado prova.

**✅ F-2a — FEITA.** O **V-2** morreu: a **DEC-050** reservou o 401 a sessão
ausente ou inválida, e a senha atual errada passou a 422 — a advogada não é mais
expulsa por um erro de digitação. Junto vieram a **DEC-051** (as gerações de
parcelas agrupadas, o plano vigente primeiro), a coluna do rótulo que parou de
exibir "Parce…", e o **seed que grava o plano inteiro** — a migração deixou de
ser pré-condição de todo reset.

**A próxima fase é a F-2b**, e o que ela tem depende de gente:

- **status do processo — BLOQUEADO pelo vocabulário da Laís.** Não se inventa
  enum que ela vai trocar: os valores viram dado gravado, tela, filtro e
  histórico de→para, e trocá-los depois é migração em quatro lugares. **As sete
  perguntas já estão com o Daniel.** Enquanto não voltarem, a F-2b não começa
  pelo status.
- **cor por status** e **histórico de→para**, que dependem do mesmo vocabulário.
- **✅ RESOLVIDO na F-2b — reativação de cliente e de processo** (achado B2).
  O que travava era a cascata perdida, e a saída foi **registrar em vez de
  inferir**: ver a **DEC-052**, acima.

  **O achado, guardado para registro:** a cascata de desativação de processo
  gravava o mesmo `ativo: false` que a remoção manual de um participante, e
  depois do fato nada os distinguia. Reativar ou ressuscitava gente removida de
  propósito, ou devolvia um processo vazio. A correção foi a cascata **marcar**
  o que derrubou (`desativadoPorCascataDe`), e a reativação restaurar só isso.

  Junto vieram as três coisas que faltavam para a reativação existir de fato: o
  `historicoAtivacao` em `Process` e `Client` (que não tinham histórico
  nenhum), o filtro `situacao` nas listagens (que escondiam os desativados sem
  alternativa) e as rotas de reativação.

- **✅ RESOLVIDO na F-2b — comandos destrutivos sem guarda.** `seed:fresh`,
  `seed:demo:clean` e a migração agora INTERROMPEM e pedem confirmação contra
  banco não-local, dizendo o nome do banco. Ver "Guarda dos comandos
  destrutivos".

- **✅ RESOLVIDO na F-2b — passo 85 / rate limit.** O teto por ambiente já
  existia e estava certo; o passo é **pré-voo**, não código a escrever. O que a
  F-2b fez foi tirar a duplicação entre os dois arquivos de rota e separar
  `test` de `development`, que compartilhavam um teto perto demais do que a
  suíte consome.

**A próxima fase é a F-2c**, e ela continua dependendo de gente: o **vocabulário
de status da Laís**. As sete perguntas seguem com o Daniel. Sem elas, não se
começa — os valores viram dado gravado, tela, filtro e histórico de→para, e
trocá-los depois é migração em quatro lugares.

Quando chegarem: status do processo, **cor por status** e o **histórico
`de → para`**. Este último tem um ponto já decidido: ele é **separado** do
`historicoAtivacao` da DEC-052, porque status é o andamento jurídico e ativação
é se o registro existe para o sistema — um processo arquivado continua ativo.

**Duas regras de negócio da F-1c.2 precisam da Laís**, porque são combinação com
cliente e não decisão técnica: a **sobra da divisão na primeira parcela**
(R$ 1.000,00 em 3 vira 333,34 + 333,33 + 333,33) e o **"Parcela 1 de 3"** da
DEC-048.

**Continua sem lint.** `node --check` é o que existe hoje; ESLint viola "zero
dependência nova" e segue como **exceção nomeada a decidir na F-2**.

**Concorrência de suítes.** Duas execuções simultâneas contra o mesmo
`lex_test` se destroem pelos hooks de limpeza. Hoje a disciplina é rodar uma de
cada vez; quando existir CI, precisa de trava.
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
