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
import portalRoutes from "./routes/portalRoutes.js";
import notFound from "./middleware/notFoundMiddleware.js";
import errorHandler from "./middleware/errorMiddleware.js";

assertSegredoDoPortal();

const app = express();

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
// Portal do cliente: prefixo, middleware e segredo próprios.
app.use("/api/portal", portalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;