# LEX — Guia de Setup Local (Equipe)

Sistema de gestão para prática jurídica (PWA). Backend em Node.js + Express + Mongoose (MongoDB Atlas); frontend em React + Vite.

Este repositório contém o **backend**. O frontend vive em um repositório separado:
**[lexuepg2026-droid/LEX-front](https://github.com/lexuepg2026-droid/LEX-front)**.

Este guia leva do clone até o login com a conta de teste, cobrindo os dois repositórios. Siga na ordem.

---

## 1. Pré-requisitos

- **Node.js 20+** e **npm** (o projeto foi validado em Node 20 / npm 10).
- Acesso aos dois repositórios da equipe: `LEX-back` (backend, este aqui) e `LEX-front`.
- Acesso ao cluster **MongoDB Atlas** do projeto (string de conexão + IP liberado).

O projeto é dividido em **dois repositórios independentes** (não é monorepo):

```
lexuepg2026-droid/LEX-back             # este repositório — API Express + Mongoose
lexuepg2026-droid/LEX-front            # React + Vite
```

Cada um tem seu próprio `package.json` e `node_modules` — clone os dois em pastas separadas e instale as dependências em cada um.

---

## 2. Clonar este repositório (backend)

```bash
git clone https://github.com/lexuepg2026-droid/LEX-back.git
cd LEX-back
```

---

## 3. Backend

### 3.1. Instalar dependências

```bash
npm install
```

### 3.2. Criar o arquivo `.env`

O `.env` **não vem no repositório** (está no `.gitignore`). Copie o modelo e preencha:

```bash
cp .env.example .env
```

Preencha o `.env`:

| Variável      | Descrição                                                                 |
|---------------|---------------------------------------------------------------------------|
| `MONGO_URI`   | String de conexão do cluster Atlas (`mongodb+srv://...`). Peça ao responsável. |
| `JWT_SECRET`  | Segredo para assinar os tokens JWT **da advogada**. Use uma string longa e aleatória. |
| `JWT_PORTAL_SECRET` | Segredo para assinar os tokens **do portal do cliente**. Obrigatório, e precisa ser **diferente** do `JWT_SECRET`. |
| `PORT`        | Porta do backend. Padrão `3001`.                                          |
| `CORS_ORIGIN` | URL(s) do frontend permitidas. Padrão `http://localhost:5173,http://localhost:5174`. |
| `NODE_ENV`    | Deixe `development` no ambiente local.                                     |

> ⚠️ **Não** deixe `NODE_ENV=production` no `.env` local nem exportado no shell: em produção o cookie de sessão vira `Secure` e o navegador não o grava em `http://localhost`, quebrando o login silenciosamente.

> ⚠️ **`JWT_PORTAL_SECRET` derruba a subida se faltar ou se for igual ao
> `JWT_SECRET`**, com mensagem dizendo o motivo. Não é chatice: nome de cookie
> não é fronteira de segurança. Com o mesmo segredo nos dois domínios, um token
> de portal renomeado para `lex-token` passa na verificação de assinatura do
> middleware da advogada, e a única barreira restante vira uma condição de `if`.

#### Rate limit dos endpoints de autenticação

Cadastro, login e troca de senha têm um balde de tentativas cada, por IP. Os
tetos são configuráveis, e **os valores default são os de produção** — não
configurar nada mantém exatamente o comportamento que já valia:

| Variável                    | Default | Endpoint protegido        |
|-----------------------------|---------|---------------------------|
| `RATE_LIMIT_CADASTRO`       | `5`     | `POST /api/auth/register` |
| `RATE_LIMIT_LOGIN`          | `10`    | `POST /api/auth/login`    |
| `RATE_LIMIT_SENHA`          | `5`     | `POST /api/auth/alterar-senha` |
| `RATE_LIMIT_JANELA_MINUTOS` | `15`    | janela de todos os baldes |
| `RATE_LIMIT_PORTAL_LOGIN`   | `5`     | `POST /api/portal/login`  |

O balde do portal é **independente** dos outros três: estourar o do portal não
trava o login da advogada, e vice-versa. O teto é mais apertado que o do login
da advogada de propósito — o código de acesso circula por WhatsApp e por papel,
e a senha é o único fator.

Fora de produção (`NODE_ENV != "production"`) cada teto é **multiplicado por
20**. Testar o cadastro seis vezes seguidas em desenvolvimento é rotina, e
ficar 15 minutos travado no meio de uma sessão custa mais do que protege numa
base local. Em produção o multiplicador não se aplica: valem os números da
tabela.

### 3.3. Liberar seu IP no MongoDB Atlas

No painel do Atlas → **Network Access** → confirme que seu IP (ou `0.0.0.0/0` para o ambiente de dev da equipe) está liberado. Sem isso, o backend não conecta e encerra na inicialização.

### 3.4. Popular a conta de teste (seed)

```bash
npm run seed:demo
```

Isso cria o usuário de teste e a massa de dados (clientes, processos, honorários, parcelas, pagamentos):

- **E-mail:** `demo@lex.dev`
- **Senha:** `Lex123456`

#### Portal do cliente (Fase 3.1)

O login do portal é **código de acesso + senha**, e não e-mail. O código sai por
vínculo processo-cliente, em `GET /api/processes/:id/clientes/:clienteId/codigo-acesso`
— o seed imprime todos no resumo final, no formato `LEX-XXXX-XXXX`.

O seed deixa os **três estados** que a interface precisa desenhar:

| Cliente | Senha | Estado |
|---|---|---|
| Ana Lima Santos | `Portal2026` | **provisória** — o portal só oferece a tela de troca |
| Maria Aparecida Costa | `MinhaSenha2026` | já trocada pelo cliente — portal liberado |
| Joao Paulo Oliveira | `MinhaSenha2026` | já trocada pelo cliente — portal liberado |
| os outros 5 | — | **sem senha**: não acessam o portal, e isso é estado válido |

No processo **"Inventario e Partilha de Bens"** (litisconsórcio) os dois
herdeiros têm acesso e a procuração de cada um está liberada no portal. Maria
**confirmou duas vezes** (uma já vista pela advogada, outra não — é a que o
contador do dashboard mostra); Joao **acessou e não confirmou**.

> A senha provisória serve para a primeira entrada e nada mais. Enquanto ela
> valer, a advogada ainda conhece a senha, e por isso a **confirmação de
> visualização é recusada** — ela só vale como recibo depois que o cliente
> definir uma senha que só ele conhece.

O seed é protegido: se a conta demo já existir, ele recusa rodar. Para recriar do zero:

```bash
npm run seed:demo:clean   # remove a conta demo e todos os dados dela
npm run seed:demo         # cria de novo
```

### 3.5. Subir o backend

```bash
npm run dev
```

API em `http://localhost:3001`. Ao subir com sucesso o console mostra `MongoDB conectado: ...` e `Server running on port 3001`.

---

### 3.6. Scripts disponíveis

| Script | O que faz |
|--------|-----------|
| `npm run dev` | Sobe a API com `nodemon` (reload automático), porta 3001. |
| `npm start` | Sobe a API com `node` puro (sem reload) — uso mais próximo de produção. |
| `npm run seed:fresh` | **Atalho recomendado.** Derruba a base e recria tudo do zero (`reset:dev` + `seed:demo`). |
| `npm run seed:demo` | Cria a conta demo e a massa de dados de teste. Recusa rodar se a demo já existir. |
| `npm run seed:demo:clean` | Remove a conta demo e todos os dados dela. |
| `npm run reset:dev` | Derruba as coleções de desenvolvimento (`users`, `clients`, `processes`, `fees`, `installments`, `payments`, `documents`). Abortado se `NODE_ENV=production`. Use quando a base local tiver dados antigos/incompatíveis com o schema atual. |

> Fluxo para recriar a base do zero: `npm run seed:fresh` (equivale a `npm run reset:dev && npm run seed:demo`).

## 4. Frontend (repositório separado)

Clone o repositório do frontend **em outra pasta**, ao lado deste (não precisa estar dentro de `LEX/`):

```bash
git clone https://github.com/lexuepg2026-droid/LEX-front.git
cd LEX-front
npm install
npm run dev
```

App em `http://localhost:5173`. Requer o backend deste repositório já rodando em `http://localhost:3001` (passo 3.5).

> O frontend fala com o backend em `http://localhost:3001/api` (fixo em `src/api/axiosConfig.js`, no repo do frontend). Se você mudar a `PORT` do backend, ajuste lá também.

---

## 5. Acessar

1. Abra `http://localhost:5173`.
2. Faça login com:
   - **E-mail:** `demo@lex.dev`
   - **Senha:** `Lex123456`
3. O sistema redireciona para o dashboard com os dados populados.

---

## 5.1. Lacunas nos modelos de documento

Nem tudo num documento sai do cadastro. Há trechos que a advogada preenche
depois — o valor combinado na audiência, o nome de uma testemunha, a data que
ainda depende do cartório.

**Para deixar um espaço a preencher, escreva `[...]` no texto da seção.**

```
O pagamento será realizado em [...] parcelas, a combinar entre as partes.
```

O sistema também reconhece, por compatibilidade, linhas de três ou mais
sublinhados (`___`), usadas para preencher à caneta depois de impresso.

Depois de gerar o documento, o preview devolve a lista de lacunas encontradas,
com a posição e o trecho ao redor de cada uma.

### Lacuna não é pendência

São coisas diferentes, e a distinção importa:

| | Lacuna | Pendência |
|---|---|---|
| O que é | Espaço deixado de propósito (`[...]`) | Variável do catálogo sem valor no cadastro |
| Exemplo | `em [...] parcelas` | `{{profissaoCliente}}` com o cliente sem profissão |
| Efeito na geração | Nenhum — o documento é gerado | **Bloqueia** com HTTP 422 |
| Efeito no download | Nenhum — o arquivo é baixado | — |
| Como resolver | Preencher no texto final, ou à caneta | Completar o cadastro e gerar de novo |

Lacuna é aviso. O download **nunca** é bloqueado por ela: o documento está
exatamente como foi pedido.

## 5.2. Valores monetários usam espaço não-separável

O formatador `moeda` (`src/utils/templateFormatters.js`) devolve
`R$ 3.000,00` — o caractere entre `R$` e o número é um **espaço
não-separável** (U+00A0), não um espaço comum (U+0020). Ele vem do
`toLocaleString("pt-BR", { style: "currency" })` do próprio Node, e é o
comportamento correto: sem ele, a quebra de linha do PDF pode separar o `R$`
do valor e deixar o símbolo pendurado no fim de uma linha e o número no
começo da seguinte, no meio de uma cláusula de honorários.

**Isso é intencional e não deve ser "corrigido".** As consequências práticas:

- Ao **comparar** strings de valor em script ou teste, `"R$ 3.000,00"` digitado
  à mão **não** é igual ao que o formatador produz. Normalize a comparação
  antes de comparar:
  ```js
  const normalizar = (s) => s.replace(/ /g, " ");
  ```
- Ao **buscar** por um valor colado da tela, o mesmo cuidado vale.
- Na renderização (PDF e DOCX) nada precisa ser feito: os dois formatos
  respeitam o U+00A0 nativamente, que é justamente o motivo de ele estar lá.

---

## 6. Solução de problemas

| Sintoma | Causa provável | Como resolver |
|--------|----------------|---------------|
| Login não entra, erro de CORS no console do browser | Porta do Vite (5173) não bate com `CORS_ORIGIN` | Garanta `CORS_ORIGIN=http://localhost:5173,http://localhost:5174` no `.env` e reinicie o backend |
| Backend encerra com "Erro ao conectar no MongoDB" | IP não liberado no Atlas, ou `MONGO_URI` errada/ausente | Libere o IP em Network Access; confira a `MONGO_URI` |
| Login retorna 500 "JWT_SECRET não configurado" | `JWT_SECRET` ausente no `.env` | Preencha `JWT_SECRET` |
| "Muitas tentativas de cadastro/login/troca de senha..." | Cada rota tem seu próprio balde por IP, em 15 min: `/register` 5, `/login` 10, `/alterar-senha` 5. A mensagem diz qual limite estourou. | Aguarde 15 min ou reinicie o backend |
| Login retorna 200 mas a sessão não persiste | Cookie saiu como `Secure` (algum `NODE_ENV=production` no ambiente) | Garanta `NODE_ENV=development` (ou não defina) no ambiente local |
| `seed:demo` diz que já existe | Conta demo já criada | Rode `npm run seed:demo:clean` antes |

---

## 7. Resumo dos comandos

```bash
# Backend (este repositório)
git clone https://github.com/lexuepg2026-droid/LEX-back.git
cd LEX-back
npm install
cp .env.example .env      # depois preencha MONGO_URI e JWT_SECRET
npm run seed:demo
npm run dev               # porta 3001 (dev, com reload); ou "npm start" sem reload

# Frontend (outro repositório, outro terminal/pasta)
git clone https://github.com/lexuepg2026-droid/LEX-front.git
cd LEX-front
npm install
npm run dev               # porta 5173

# Login: demo@lex.dev / Lex123456
```
