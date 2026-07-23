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
| `JWT_SECRET`  | Segredo para assinar os tokens JWT. Use uma string longa e aleatória.     |
| `PORT`        | Porta do backend. Padrão `3001`.                                          |
| `CORS_ORIGIN` | URL(s) do frontend permitidas. Padrão `http://localhost:5173,http://localhost:5174`. |
| `NODE_ENV`    | Deixe `development` no ambiente local.                                     |

> ⚠️ **Não** deixe `NODE_ENV=production` no `.env` local nem exportado no shell: em produção o cookie de sessão vira `Secure` e o navegador não o grava em `http://localhost`, quebrando o login silenciosamente.

### 3.3. Liberar seu IP no MongoDB Atlas

No painel do Atlas → **Network Access** → confirme que seu IP (ou `0.0.0.0/0` para o ambiente de dev da equipe) está liberado. Sem isso, o backend não conecta e encerra na inicialização.

### 3.4. Popular a conta de teste (seed)

```bash
npm run seed:demo
```

Isso cria o usuário de teste e a massa de dados (clientes, processos, honorários, parcelas, pagamentos):

- **E-mail:** `seed-demo@lex.dev`
- **Senha:** `SeedDemo123!`

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
   - **E-mail:** `seed-demo@lex.dev`
   - **Senha:** `SeedDemo123!`
3. O sistema redireciona para o dashboard com os dados populados.

---

## 6. Solução de problemas

| Sintoma | Causa provável | Como resolver |
|--------|----------------|---------------|
| Login não entra, erro de CORS no console do browser | Porta do Vite (5173) não bate com `CORS_ORIGIN` | Garanta `CORS_ORIGIN=http://localhost:5173,http://localhost:5174` no `.env` e reinicie o backend |
| Backend encerra com "Erro ao conectar no MongoDB" | IP não liberado no Atlas, ou `MONGO_URI` errada/ausente | Libere o IP em Network Access; confira a `MONGO_URI` |
| Login retorna 500 "JWT_SECRET não configurado" | `JWT_SECRET` ausente no `.env` | Preencha `JWT_SECRET` |
| "Muitas tentativas. Tente novamente em 15 minutos." | Rate limiter (10 tentativas / 15 min em `/login` e `/register`) | Aguarde 15 min ou reinicie o backend |
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
npm run dev               # porta 3001

# Frontend (outro repositório, outro terminal/pasta)
git clone https://github.com/lexuepg2026-droid/LEX-front.git
cd LEX-front
npm install
npm run dev               # porta 5173

# Login: seed-demo@lex.dev / SeedDemo123!
```
