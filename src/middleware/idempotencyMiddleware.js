import IdempotencyKey, { calcularExpiracao, chaveExpirada } from "../models/IdempotencyKey.js";

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTÊNCIA — a mesma gravação duas vezes não cria duas (F-5b, DEC-059)
//
// ── O contrato ──────────────────────────────────────────────────────────
// O cliente manda `Idempotency-Key: <uuid>`. O servidor:
//
//   1. **reserva** a chave (índice único) antes de executar;
//   2. executa a rota normalmente;
//   3. guarda a resposta de sucesso junto da chave;
//   4. numa segunda requisição com a MESMA chave, **devolve a mesma resposta
//      sem executar de novo**, com o cabeçalho `Idempotent-Replay: true`.
//
// ── Por que CABEÇALHO, e não campo no corpo ─────────────────────────────
// Duas razões, e a segunda decidiu:
//
//   1. a chave é sobre a REQUISIÇÃO, não sobre o registro — ela não pertence
//      ao corpo do compromisso mais do que o `Content-Type` pertence;
//   2. **`validations/shared/camposPermitidos.js` recusa campo desconhecido no
//      corpo do PATCH.** Um `chaveIdempotencia` no corpo seria rejeitado com
//      400 pela própria guarda que protege o contrato — ou obrigaria a abrir
//      exceção nela, que é pior. Nenhum validador, nenhum model e nenhum
//      contrato de rota mudou por causa desta fase.
//
// ── Sem chave, nada muda ────────────────────────────────────────────────
// Requisição sem o cabeçalho passa direto. As telas que gravam online não
// precisam saber que a fila existe.
//
// ── O que NÃO é guardado ────────────────────────────────────────────────
// Resposta de ERRO. Um 400 ou um 409 não é resultado a repetir: a fila vai
// mostrar a falha à advogada, ela corrige e manda de novo — e a correção
// precisa poder executar. Por isso a reserva é **apagada** quando a resposta
// não é 2xx.
// ═══════════════════════════════════════════════════════════════════════════

// UUID, em qualquer versão. Validação à mão, como manda a convenção — e
// estrita de propósito: chave curta ou previsível ("1", "salvar") colidiria
// entre operações diferentes e faria uma devolver a resposta da outra.
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ehChaveValida = (chave) =>
  typeof chave === "string" && FORMATO_UUID.test(chave.trim());

// A identidade da operação: método + caminho, sem query. É o que distingue
// "criar compromisso" de "mudar a fase do processo X" quando a mesma chave
// aparece nas duas — defeito de cliente que precisa ser recusado, e não
// respondido com o resultado da outra.
export const identidadeDaOperacao = (req) =>
  `${req.method} ${req.originalUrl.split("?")[0]}`;

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const idempotency = async (req, res, next) => {
  const bruto = req.get("Idempotency-Key");
  if (!bruto) return next();

  if (!ehChaveValida(bruto)) {
    return next(
      erro(400, "Idempotency-Key inválida: informe um UUID.", { campo: "Idempotency-Key" })
    );
  }

  const chave = bruto.trim();
  const usuarioId = req.user._id;
  const operacao = identidadeDaOperacao(req);
  const agora = new Date();

  let reserva;
  try {
    reserva = await IdempotencyKey.create({
      usuarioId,
      chave,
      operacao,
      estado: "emAndamento",
      expiraEm: calcularExpiracao(agora)
    });
  } catch (err) {
    if (err.code !== 11000) return next(err);

    const existente = await IdempotencyKey.findOne({ usuarioId, chave });

    // O coletor do Mongo passa a cada ~60s: uma chave vencida pode ainda estar
    // aqui. Quem lê confere a data — confiar no coletor faria a expiração
    // depender de quando o servidor resolveu varrer.
    if (!existente || chaveExpirada(existente, agora)) {
      if (existente) await IdempotencyKey.deleteOne({ _id: existente._id });
      return idempotency(req, res, next);
    }

    if (existente.operacao !== operacao) {
      return next(
        erro(409, "Esta chave de idempotência já foi usada em outra operação.", {
          regra: "chaveReutilizada"
        })
      );
    }

    if (existente.estado === "emAndamento") {
      // A primeira requisição ainda está sendo processada. Responder qualquer
      // coisa aqui seria inventar um resultado; recusar faz a fila tentar de
      // novo, que é o comportamento certo.
      return next(
        erro(409, "Esta gravação ainda está sendo processada. Tente de novo em instantes.", {
          regra: "idempotenciaEmAndamento"
        })
      );
    }

    res.set("Idempotent-Replay", "true");
    return res.status(existente.respostaStatus).json(existente.respostaCorpo);
  }

  // ── Captura da resposta ────────────────────────────────────────────────
  //
  // A gravação da chave acontece ANTES de a resposta sair. É alguns
  // milissegundos a mais, e é o que impede a janela em que o cliente já
  // recebeu o resultado e a chave ainda não existe — janela em que um reenvio
  // executaria de novo e duplicaria, que é exatamente o que este arquivo
  // existe para impedir.
  //
  // Se a própria gravação da chave falhar, a resposta sai assim mesmo: o
  // registro foi criado, e negar o resultado ao cliente por causa do
  // apontamento seria trocar um risco por um dano certo.
  const responder = res.json.bind(res);

  res.json = (corpo) => {
    const status = res.statusCode;

    const registrar =
      status >= 200 && status < 300
        ? IdempotencyKey.updateOne(
            { _id: reserva._id },
            { $set: { estado: "concluida", respostaStatus: status, respostaCorpo: corpo } }
          )
        : IdempotencyKey.deleteOne({ _id: reserva._id });

    registrar.then(
      () => responder(corpo),
      () => responder(corpo)
    );

    return res;
  };

  return next();
};

export default idempotency;
