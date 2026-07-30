// Sonda do rate limit do portal, executada em PROCESSO PRÓPRIO.
//
// Precisa ser um processo à parte porque os limitadores são construídos na
// CARGA do módulo de rotas, lendo `process.env` uma única vez — exatamente
// como em `authRoutes.js`. Baixar o teto depois de `src/app.js` ter sido
// importado não teria efeito nenhum, e um teste que tentasse isso passaria
// sem testar coisa alguma.
//
// Aqui o teto do portal entra apertado e o da advogada, folgado. A sonda
// estoura o do portal e então tenta o login da advogada: se os baldes forem
// independentes, o segundo continua respondendo.
//
// Imprime uma linha JSON na saída padrão, que o teste lê.

import { createServer } from "node:http";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_JANELA_MINUTOS = "15";
process.env.RATE_LIMIT_PORTAL_LOGIN = "1"; // ×20 fora de produção = 20
process.env.RATE_LIMIT_LOGIN = "1000";
process.env.RATE_LIMIT_CADASTRO = "1000";
process.env.RATE_LIMIT_SENHA = "1000";
process.env.JWT_SECRET = "sonda-advogada";
process.env.JWT_PORTAL_SECRET = "sonda-portal";

const { default: app } = await import("../../../src/app.js");

const servidor = createServer(app);
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${servidor.address().port}/api`;

const chamar = async (rota, corpo) => {
  const r = await fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  });
  return r.status;
};

// ── Nenhuma requisição pode tocar o banco ─────────────────────────────────
// Este processo sobe `src/app.js` SEM `connectDB()`: qualquer consulta ficaria
// pendurada no buffer do Mongoose até estourar o timeout, e 40 requisições
// assim travariam a sonda por minutos. Foi o que aconteceu na primeira versão.
//
// Os payloads abaixo são recusados por VALIDAÇÃO, antes de qualquer model ser
// consultado — e isso não enfraquece a medida: o limitador é middleware e roda
// ANTES do controller, então ele conta a tentativa do mesmo jeito. O que se
// mede aqui é o balde, não a autenticação.
const statusPortal = [];
for (let i = 0; i < 40; i += 1) {
  // Código com formato inválido: `isCodigoAcessoValido` reprova e o service
  // devolve 401 sem consultar nada.
  statusPortal.push(await chamar("/portal/login", { codigoAcesso: "NAO-E-CODIGO", senha: "x" }));
}

// Com o balde do portal estourado, os baldes da advogada têm de continuar
// abertos. Payloads incompletos: 400 vem da validação, sem tocar o banco.
const statusAdvogada = await chamar("/auth/login", { email: "ninguem@lex.test" });
const statusCadastro = await chamar("/auth/register", { email: "x" });

process.stdout.write(JSON.stringify({
  portalEstourou: statusPortal.includes(429),
  primeiroPortal: statusPortal[0],
  ultimoPortal: statusPortal[statusPortal.length - 1],
  advogadaAposEstouro: statusAdvogada,
  cadastroAposEstouro: statusCadastro
}) + "\n");

await new Promise((r) => servidor.close(r));
process.exit(0);
