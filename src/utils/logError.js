// ═══════════════════════════════════════════════════════════════════════════
// LOG DE ERRO DE SERVIDOR — o mínimo, sem biblioteca (Fase F-0)
//
// ── O buraco que isto fecha ────────────────────────────────────────────────
// `errorMiddleware` logava o erro completo, com stack, mas guardado atrás de
// `if (NODE_ENV !== "production")`. Em produção, portanto, um 500 não deixava
// rastro NENHUM: a advogada relataria "deu erro ao salvar" e não haveria onde
// olhar. O único registro do incidente seria a memória dela.
//
// ── O que entra na linha, e o que NÃO entra ───────────────────────────────
// Entra: carimbo de tempo, método, rota, status e mensagem. É o suficiente
// para responder "quando, onde e o quê".
//
// **Não entra corpo de requisição, nem query, nem cookie, nem cabeçalho, nem
// nada de `req.user`.** Não é economia de bytes: o corpo de um `POST /clients`
// carrega CPF, endereço e telefone de um terceiro que não é usuário do
// sistema, e a advogada é controladora desse dado. Log é arquivo que sobrevive
// ao incidente, é copiado para triagem e raramente é apagado — dado pessoal
// dentro dele vaza por um caminho que ninguém audita. A mesma minimização que
// a DEC-029 aplicou às confirmações (sem IP, sem user-agent) vale aqui.
//
// **A ROTA é o padrão do Express (`req.route`/`baseUrl`), não a URL crua.**
// `/api/clients/:id` em vez de `/api/clients/6a82…`: o id identifica um
// cliente real, e a pergunta que o log responde é "qual endpoint quebrou", não
// "em qual registro". Quando o padrão não está disponível (erro antes do
// roteamento), cai para `baseUrl` ou para "-".
//
// ── Por que só 5xx ────────────────────────────────────────────────────────
// 4xx é conversa normal: validação recusada, 404, 409 de integridade. Logar
// tudo encheria a saída de coisa esperada e o 500 de verdade se perderia no
// meio — que é o mesmo efeito de não logar.
//
// ── Por que `console.error` e não uma biblioteca ──────────────────────────
// O limite permanente do projeto é não instalar dependência sem decisão
// escrita, e um coletor de logs (PaaS, systemd, Docker) já captura `stderr`.
// Uma linha por incidente, em formato estável e fácil de filtrar, resolve a
// pergunta desta fase. Se um dia houver agregador com consulta estruturada, o
// ponto único de troca é este arquivo.
// ═══════════════════════════════════════════════════════════════════════════

// Padrão da rota, nunca a URL com ids reais dentro.
const rotaDe = (req) => {
  if (!req) return "-";
  const base = req.baseUrl || "";
  const caminho = req.route?.path;
  if (caminho) return `${base}${caminho === "/" ? "" : caminho}` || "/";
  return base || "-";
};

export const logError = (err, req, status) => {
  // 4xx é conversa normal da API, não incidente.
  if (status < 500) return;

  const partes = [
    new Date().toISOString(),
    `status=${status}`,
    `metodo=${req?.method ?? "-"}`,
    `rota=${rotaDe(req)}`,
    `erro=${err?.name ?? "Error"}`,
    `mensagem=${JSON.stringify(err?.message ?? "")}`
  ];

  console.error(`[lex:erro] ${partes.join(" ")}`);

  // A stack vai numa segunda linha, e não dentro da primeira: assim a linha de
  // resumo continua grep-ável e de largura previsível.
  if (err?.stack) console.error(err.stack);
};

export default logError;
