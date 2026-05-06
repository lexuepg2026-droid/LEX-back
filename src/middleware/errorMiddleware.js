// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || 500;
  const message = err.message || "Erro interno do servidor";

  if (process.env.NODE_ENV !== "production") {
    console.error(`[${status}] ${message}`, err.stack);
  }

  const body = { message };
  if (err.errors) body.errors = err.errors;

  res.status(status).json(body);
};

export default errorHandler;
