// src/app.js
import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import processRoutes from "./routes/processRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import feeRoutes from "./routes/feeRoutes.js";
import installmentRoutes from "./routes/installmentRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import notFound from "./middleware/notFoundMiddleware.js";
import errorHandler from "./middleware/errorMiddleware.js";

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
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

app.use(notFound);
app.use(errorHandler);

export default app;