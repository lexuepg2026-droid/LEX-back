// Cliente HTTP com pote de cookies.
//
// O `fetch` nativo do Node não guarda cookie entre requisições, e a
// autenticação do LEX é cookie httpOnly `lex-token`. Sem isto, ou se manda o
// token no header (que não é como o app funciona) ou não se testa sessão
// nenhuma.
//
// Cada instância é uma SESSÃO independente. É esse isolamento que sustenta o
// bloco da Parte 3: o cliente de A e o de B nunca compartilham cookie, do
// mesmo jeito que dois navegadores não compartilham.

import { urlBase } from "./server.js";

const parseSetCookie = (valores) => {
  const cookies = new Map();
  for (const bruto of valores) {
    const primeiro = bruto.split(";")[0];
    const igual = primeiro.indexOf("=");
    if (igual === -1) continue;
    const nome = primeiro.slice(0, igual).trim();
    const valor = primeiro.slice(igual + 1).trim();
    // `Max-Age=0` ou data no passado é o logout apagando o cookie.
    const expirado =
      /max-age=0/i.test(bruto) ||
      /expires=Thu, 01 Jan 1970/i.test(bruto);
    if (expirado) cookies.set(nome, null);
    else cookies.set(nome, valor);
  }
  return cookies;
};

export class ClienteApi {
  constructor(rotulo = "anônimo") {
    this.rotulo = rotulo;
    this.cookies = new Map();
    this.usuario = null;
  }

  get headerCookie() {
    const pares = [...this.cookies.entries()]
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`);
    return pares.length > 0 ? pares.join("; ") : null;
  }

  async requisitar(metodo, rota, corpo, opcoes = {}) {
    const headers = { ...(opcoes.headers ?? {}) };
    if (corpo !== undefined) headers["Content-Type"] = "application/json";
    const cookie = this.headerCookie;
    if (cookie) headers.Cookie = cookie;

    const resposta = await fetch(`${urlBase()}${rota}`, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });

    const recebidos = resposta.headers.getSetCookie?.() ?? [];
    for (const [nome, valor] of parseSetCookie(recebidos)) {
      if (valor === null) this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }

    const tipo = resposta.headers.get("content-type") ?? "";
    let body = null;
    let bytes = null;

    if (tipo.includes("application/json")) {
      const texto = await resposta.text();
      body = texto.length > 0 ? JSON.parse(texto) : null;
    } else {
      bytes = Buffer.from(await resposta.arrayBuffer());
      body = null;
    }

    return {
      status: resposta.status,
      headers: resposta.headers,
      tipo,
      body,
      bytes
    };
  }

  get(rota, opcoes) { return this.requisitar("GET", rota, undefined, opcoes); }
  post(rota, corpo, opcoes) { return this.requisitar("POST", rota, corpo ?? {}, opcoes); }
  patch(rota, corpo, opcoes) { return this.requisitar("PATCH", rota, corpo ?? {}, opcoes); }
  put(rota, corpo, opcoes) { return this.requisitar("PUT", rota, corpo ?? {}, opcoes); }
  delete(rota, opcoes) { return this.requisitar("DELETE", rota, undefined, opcoes); }

  get autenticado() {
    return this.cookies.has("lex-token");
  }
}
