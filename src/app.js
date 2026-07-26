// src/app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import processRoutes from "./routes/processRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import feeRoutes from "./routes/feeRoutes.js";
import installmentRoutes from "./routes/installmentRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import financeiroRoutes from "./routes/financeiroRoutes.js";
import notFound from "./middleware/notFoundMiddleware.js";
import errorHandler from "./middleware/errorMiddleware.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "LEX API running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/processes", processRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/installments", installmentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/financeiro", financeiroRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;