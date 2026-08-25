// src/app.js
// Primeiro import de propósito: define os defaults de schema do Mongoose antes
// de qualquer model ser compilado pela cadeia de rotas abaixo.
import "./config/mongooseDefaults.js";

// Guarda de configuração do portal do cliente. Roda na CARGA, antes de
// qualquer rota ser montada: um segredo ausente ou compartilhado com o
// `JWT_SECRET` derruba a subida em vez de quebrar no primeiro login real.
import assertSegredoDoPortal from "./config/portalSecret.js";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import processRoutes from "./routes/processRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import secaoRoutes from "./routes/secaoRoutes.js";
import feeRoutes from "./routes/feeRoutes.js";
import installmentRoutes from "./routes/installmentRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import financeiroRoutes from "./routes/financeiroRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import portalRoutes from "./routes/portalRoutes.js";
import notFound from "./middleware/notFoundMiddleware.js";
import errorHandler from "./middleware/errorMiddleware.js";

assertSegredoDoPortal();

const app = express();

// ═══════════════════════════════════════════════════════════════════════════
// PREPARO DE PRODUÇÃO (achado 1.4 — Fase 4.5). Sem helmet, à mão.
//
// `trust proxy: 1` — UM salto, não `true`. Com `true` o Express acredita no
// `X-Forwarded-For` inteiro, inclusive no trecho que o cliente escreveu: quem
// quisesse furar o rate limit mandaria um IP falso na frente da cadeia e
// ganharia um balde novo por requisição. Com `1`, só o proxy imediatamente à
// frente (o do hospedeiro) é considerado confiável — que é a topologia real de
// um deploy em PaaS. É disso que `express-rate-limit` depende para agrupar por
// IP de verdade.
app.set("trust proxy", 1);

// O `X-Powered-By` anuncia "Express" em toda resposta. Não é vulnerabilidade,
// é reconhecimento gratuito: poupa ao atacante a pergunta "que stack é esta?".
app.disable("x-powered-by");

// Os quatro cabeçalhos, escritos à mão porque a fase proíbe dependência nova e
// porque são quatro linhas — helmet traria quinze defaults que ninguém leu.
app.use((req, res, next) => {
  // Impede o navegador de "adivinhar" o tipo do conteúdo. Sem isso, um PDF ou
  // DOCX servido pelo download poderia ser reinterpretado como HTML.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A API não é para ser embutida em frame nenhum. `DENY` e não `SAMEORIGIN`:
  // não existe tela do LEX que abra a própria API dentro de um frame.
  res.setHeader("X-Frame-Options", "DENY");
  // Não vaza caminho nem query string para terceiros; mantém a origem em
  // navegação cross-site e o path completo só dentro do próprio site.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS **só em produção**. Em desenvolvimento o app roda em `http://localhost`
  // e mandar o navegador exigir HTTPS daquele host por um ano deixaria a
  // máquina do Daniel sem conseguir abrir o próprio `localhost` — e o efeito
  // sobrevive a desinstalar o servidor, porque quem guarda é o navegador.
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return next();
});

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(cookieParser());
// 400 kb, não o padrão de 100 kb do express.json: o logo do escritório é
// aceito até 200 KB de base64 (authValidation), e com o padrão a requisição
// morria com 413 ANTES de a validação rodar — o teto de 200 KB era
// inalcançável e a mensagem de erro, enganosa.
//
// 400 kb dá folga para o logo mais o resto do payload de perfil, sem virar
// porta aberta: nenhum outro endpoint da API recebe corpo grande.
app.use(express.json({ limit: "400kb" }));

app.get("/", (req, res) => {
  res.json({ message: "LEX API running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/processes", processRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/secoes", secaoRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/installments", installmentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/financeiro", financeiroRoutes);
// F-3 — o evento se GRAVA em `/events`; o calendário só LÊ, e devolve as duas
// naturezas juntas. A separação é a DEC-055 na fiação: não há rota de escrita
// em `/calendar`, porque é ali que alguém gravaria a derivada.
app.use("/api/events", eventRoutes);
app.use("/api/calendar", calendarRoutes);
// Portal do cliente: prefixo, middleware e segredo próprios.
app.use("/api/portal", portalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;