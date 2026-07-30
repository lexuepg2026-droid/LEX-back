// Sobe `src/app.js` numa porta efêmera, dentro do próprio processo de teste.
//
// Por que HTTP real e não chamada de service direto: o valor está justamente
// na cadeia que o service não vê — `authMiddleware`, `errorMiddleware`, o
// mapeamento de `ValidationError`/`CastError` para 400, a allowlist de chaves
// estruturadas do 409. Chamar o service pularia exatamente o que se quer
// proteger.
//
// `import.meta` estático não serve aqui: `env.js` PRECISA ter rodado antes de
// `src/app.js` ser avaliado, porque `authRoutes.js` lê `process.env` na carga
// para montar os limitadores. Import dinâmico torna a ordem explícita.

import "./env.js";

import { createServer } from "node:http";

let servidor = null;
let baseUrl = null;

export const subirApp = async () => {
  if (baseUrl) return baseUrl;

  const { default: app } = await import("../../src/app.js");

  servidor = createServer(app);
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));

  const { port } = servidor.address();
  baseUrl = `http://127.0.0.1:${port}/api`;
  return baseUrl;
};

export const derrubarApp = async () => {
  if (!servidor) return;
  await new Promise((resolve) => servidor.close(resolve));
  servidor = null;
  baseUrl = null;
};

export const urlBase = () => {
  if (!baseUrl) throw new Error("subirApp() não foi chamado.");
  return baseUrl;
};
