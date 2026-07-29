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

Variáveis de ambiente: `PORT`, `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`,
`RATE_LIMIT_JANELA_MINUTOS` e os tetos por operação — definidas em `.env`
(nunca versionado). Ver `.env.example`.

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
    templateVariables.js     Catálogo FECHADO de variáveis (47 chaves)
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
| Financeiro       | ✅    | (fee)      | ✅      | — (agrega)                      | —          |

**10 módulos, 11 models** (`shared/enderecoSchema.js` é sub-schema, não model).

O módulo de documentos tem **quatro** services, por responsabilidade:

| Service                        | Responsabilidade                                  |
|--------------------------------|---------------------------------------------------|
| `documentService.js`           | CRUD e vínculos documento ↔ seção (ordem)         |
| `documentGenerationService.js` | Modelos, resolução de variáveis, geração, texto    |
| `documentRenderService.js`     | Timbrado e layout — **fonte da verdade do visual** |
| `documentDownloadService.js`   | Empacota PDF/DOCX, nome do arquivo, content-type   |

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
| GET    | `/variaveis`                     | —                                                 | `{ total: 47, grupos: [{ origem, rotulo, descricao, total, variaveis: [{ chave, rotulo, descricao }] }] }` |
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
`POST /` · `GET /` · `GET /:id` · `PUT /:id` · `DELETE /:id`

### `/api/dashboard`
`GET /` · `GET /status` · `GET /honorarios-por-mes`

### `/api/financeiro`
`GET /resumo`

---

## Módulo de documentos — decisões fechadas

Não reabrir sem motivo novo e escrito.

1. **Uma única classe de variável.** O catálogo é o mecanismo de
   autopreenchimento. O que não vem de cadastro, a advogada escreve no editor
   de texto final. **Não existe** sintaxe de variável de preenchimento nem
   formulário na geração.
2. **O catálogo é FECHADO, em 47 chaves** — `cliente` 20, `usuario` 10,
   `processo` 9, `honorario` 6, `sistema` 2. A validação acontece no
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

## Dívidas conhecidas e aceitas

- **`src/utils/texto.js` duplica `semAcento`**, que também existe dentro de
  `documentRenderService.js`. Registrado na Fase 2D.1. **Não unificar** sem
  abrir `documentRenderService.js`, que é a fonte da verdade do visual e só se
  toca em fase que tenha isso no escopo.
- `percentualHonorario` **fica fora do catálogo de propósito**: o campo
  `percentual` só nasce na Fase 4, e declarar a variável antes do campo
  produziria pendência perpétua que a advogada não teria como resolver.
- `valorParcela` fica `undefined` quando as parcelas são desiguais. É
  honesto: dividir o total pelo número produziria um valor que não
  corresponde a nenhuma cobrança real.
- Não há `CLAUDE.md` no repositório do frontend. As convenções de interface
  estão no `README.md` e em `docs/validacao-manual.md`.

---

## Limites permanentes

- **Nenhuma dependência nova** sem decisão explícita. Subir a *versão* de
  pacote existente, dentro do semver, para fechar vulnerabilidade, não conta
  como dependência nova.
- **Nunca `npm audit fix --force`** — sobe major de Express/Mongoose e quebra
  a API.
- **Não alterar `documentRenderService.js`** fora de fase que o tenha no
  escopo.
- **Não alterar o catálogo de variáveis.** Divergência encontrada se
  **reporta**, não se corrige de passagem.
- Não mexer em `Fee` nem no financeiro fora da Fase 4. Não criar portal fora
  da Fase 3.
- **Não reescrever histórico publicado.** Sem `rebase`, `reset --hard` ou
  `push --force` sobre `main`. Correção de coisa mergeada é commit novo, para
  a frente.
- Não expor secrets, senhas, tokens, strings de conexão ou IPs. Não alterar
  `.env`.
- Não remover regra de isolamento (`usuarioId`) nem filtro `ativo: true`.
- `git push` só com confirmação explícita.
- Suíte de testes automatizados é **fase própria, já planejada** — não criar
  por conta.

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

### Contagens esperadas do seed

| Coleção            | Qtde |
|--------------------|------|
| `clients`          | 8    |
| `processes`        | 10   |
| `processo_clientes`| 12   |
| `fees`             | 12   |
| `installments`     | 19   |
| `payments`         | 10   |
| `documents`        | 17   |
| `secoes`           | 10   |
| `documento_secao`  | 33   |

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
