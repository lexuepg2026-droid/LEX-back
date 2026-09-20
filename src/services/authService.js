import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authValidation from "../validations/authValidation.js";
import { somenteDigitos } from "../utils/documentos.js";
import { MENSAGEM_EMAIL_INVALIDO, normalizarEmail } from "../utils/email.js";
import { gerarToken, lerToken, hashesIguais } from "../utils/tokenUsuario.js";
import {
  enviarEmail, urlBaseDoApp, registrarFalhaDeEmail
} from "./emailService.js";
import {
  montarEmailConfirmacao, montarEmailRecuperacao,
  PRAZO_CONFIRMACAO_HORAS, PRAZO_RECUPERACAO_MINUTOS
} from "./emailTemplates.js";

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET não configurado");
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const badRequest = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 400;
  if (campo) error.campo = campo;
  return error;
};

// ── DEC-063: qual input destacar quando o cadastro é recusado ─────────────
//
// `validateRegisterPayload` devolve UMA string — a primeira falha encontrada —
// e o `campo` do 400 é o que faz o formulário destacar o input certo. Sem ele,
// quem erra o e-mail na etapa 1 do assistente lê "E-mail inválido" na etapa 2,
// sem saber para onde voltar.
//
// A associação é por MENSAGEM porque é isso que a validação devolve, e o mapa
// é curto e fechado de propósito: só os campos que a etapa 1 mostra. Uma
// mensagem sem entrada aqui sai sem `campo`, e a tela continua exibindo o
// texto — que é o comportamento de antes, e é aceitável.
//
// **Não é regex sobre a mensagem.** É igualdade contra as constantes que a
// própria validação usa — foi assim que a Fase 1.3 quebrou, roteando a etapa do
// cadastro por `/mail/i`, e é o que a DEC-031 e o contrato do 409 existem para
// não repetir.
const CAMPO_POR_MENSAGEM = Object.freeze({
  [MENSAGEM_EMAIL_INVALIDO]: "email",
  "Nome completo é obrigatório": "nomeCompleto",
  "CPF inválido": "cpf"
});

// ── 422: credencial conferida DENTRO de uma sessão válida (DEC-050) ────────
//
// Não é 401, e a diferença não é de gosto. O 401 estava sendo usado para duas
// perguntas diferentes:
//
//   "não sei quem você é"                        → sessão ausente ou inválida
//   "sei quem você é, e este dado está errado"   → credencial conferida aqui
//
// Só a primeira justifica descartar a sessão. Enquanto as duas responderam
// 401, o interceptor do axios — que trata todo 401 como sessão perdida — EXPULSAVA
// a advogada do sistema por ela ter errado a digitação da própria senha atual
// na tela de troca de senha (defeito V-2).
//
// A correção é semântica, e não no interceptor: com o 401 reservado a sessão,
// o interceptor fica trivialmente correto e não precisa conhecer rota nenhuma.
// Lista de exceção de rota no frontend resolveria ESTE caso e apodreceria no
// próximo — a rota seguinte que devolvesse 401 por engano não estaria nela, e
// o defeito voltaria calado.
//
// 422 e não 400: o corpo está bem formado e os campos são válidos: o que falha
// é a CONFERÊNCIA do valor contra o que está gravado. É a mesma leitura que o
// módulo de documentos já dá ao 422 desde a Fase 4.6.
const unprocessable = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 422;
  if (campo) error.campo = campo;
  return error;
};

// `campo` acompanha o 409 para o cliente rotear sem depender do texto da
// mensagem (o RegisterPage decidia a etapa de retorno por regex; qualquer
// reescrita do texto quebrava o roteamento em silêncio). A mensagem continua
// sendo o que o usuário lê; `campo` é só para a lógica.
const conflict = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 409;
  if (campo) error.campo = campo;
  return error;
};

// Rede de segurança: se dois requests concorrentes passarem pelas checagens
// prévias, o índice único do Mongo dispara 11000 — identificamos qual violou.
const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000) {
    const pattern = error.keyPattern || {};
    if (pattern.email) {
      throw conflict("E-mail já cadastrado", "email");
    }
    if (pattern.cpf) {
      throw conflict("CPF já cadastrado", "cpf");
    }
    if (pattern["oab.numero"] || pattern["oab.estado"]) {
      throw conflict("OAB já cadastrada nesta UF", "oab");
    }
    throw conflict("Registro duplicado");
  }
  throw error;
};

const sanitizeUser = (usuario) => {
  return {
    id: usuario._id,
    nomeCompleto: usuario.nomeCompleto,
    email: usuario.email,
    cpf: usuario.cpf,
    telefone: usuario.telefone,
    oab: usuario.oab,
    advocacia: usuario.advocacia,
    endereco: usuario.endereco,
    ativo: usuario.ativo,
    ultimoLogin: usuario.ultimoLogin,
    // A-2: a tela mostra o aviso enquanto isto for null. Só a DATA sai — os
    // hashes de token nunca (`select: false` no model, e a lista é allowlist).
    emailConfirmadoEm: usuario.emailConfirmadoEm ?? null,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt
  };
};

const registerUser = async (data) => {
  const validationError = authValidation.validateRegisterPayload(data);
  if (validationError) {
    throw badRequest(validationError, CAMPO_POR_MENSAGEM[validationError]);
  }

  // DEC-063 — a MESMA normalização do login e do model (`lowercase: true`).
  // É ela que faz `Daniel@X.com ` e `daniel@x.com` serem o mesmo e-mail, e sem
  // ela o índice único não os veria como iguais.
  const normalizedEmail = normalizarEmail(data.email);
  const cpf = somenteDigitos(data.cpf);
  const oabNumero = somenteDigitos(data.oab.numero);
  const oabEstado = String(data.oab.estado).trim().toUpperCase();

  if (await User.findOne({ email: normalizedEmail })) {
    throw conflict("E-mail já cadastrado", "email");
  }
  if (await User.findOne({ cpf })) {
    throw conflict("CPF já cadastrado", "cpf");
  }
  if (await User.findOne({ "oab.numero": oabNumero, "oab.estado": oabEstado })) {
    throw conflict("OAB já cadastrada nesta UF", "oab");
  }

  const senhaHash = await bcrypt.hash(data.senha, 10);

  try {
    const novoUsuario = await User.create({
      nomeCompleto: data.nomeCompleto.trim(),
      email: normalizedEmail,
      senhaHash,
      cpf,
      telefone: data.telefone,
      oab: { numero: oabNumero, estado: oabEstado },
      advocacia: {
        nome: data.advocacia.nome,
        chavePix: data.advocacia.chavePix,
        instagram: data.advocacia.instagram,
        site: data.advocacia.site
      },
      endereco: data.endereco
    });

    // A-2: a confirmação NÃO segura o cadastro. O e-mail sai em segundo plano e
    // uma falha do provedor só é registrada — a conta existe, a advogada entra
    // (decisão do Daniel: login liberado), e o reenvio está a um clique.
    try {
      await emitirToken({ usuario: novoUsuario, ...FINALIDADE.confirmacao, aguardarEnvio: false });
    } catch (error) {
      registrarFalhaDeEmail("confirmação de cadastro", error);
    }

    // Devolve token junto: quem acabou de se cadastrar já está autenticado, e
    // o controller emite o mesmo cookie `lex-token` do login. Mandar a
    // advogada digitar de novo a senha que ela escolheu dois campos atrás é
    // atrito sem contrapartida de segurança — a identidade acabou de ser
    // comprovada pelo próprio cadastro.
    return {
      message: "Usuário cadastrado com sucesso",
      token: generateToken(novoUsuario._id),
      usuario: sanitizeUser(novoUsuario)
    };
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

const loginUser = async ({ email, senha }) => {
  const validationError = authValidation.validateLoginPayload({ email, senha });
  if (validationError) {
    throw badRequest(validationError);
  }

  // Normalizado ANTES de comparar, e não só antes de gravar: o `lowercase` do
  // schema atua na escrita, não na consulta. Sem isto, quem se cadastrou como
  // `daniel@x.com` e digita `Daniel@X.com` no login não seria encontrado.
  const normalizedEmail = normalizarEmail(email);

  const usuario = await User.findOne({ email: normalizedEmail });

  // E-mail inexistente e senha errada respondem exatamente igual (401,
  // "Credenciais inválidas") para não permitir enumeração de contas.
  // authLimiter já cobre força bruta; não vale complexidade extra aqui.
  //
  // CONTINUA 401 sob a DEC-050, e é o significado certo: aqui não HÁ sessão —
  // é justamente o pedido para criar uma. "Não sei quem você é" é literalmente
  // a resposta. O interceptor não desloga ninguém por isto porque não há
  // sessão para perder; ver `api/axiosConfig.js` no frontend.
  if (!usuario) {
    const error = new Error("Credenciais inválidas");
    error.statusCode = 401;
    throw error;
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);

  if (!senhaValida) {
    const error = new Error("Credenciais inválidas");
    error.statusCode = 401;
    throw error;
  }

  // updateOne em vez de save() para não disparar hooks/validators desnecessários.
  await User.updateOne({ _id: usuario._id }, { $set: { ultimoLogin: new Date() } });
  usuario.ultimoLogin = new Date();

  const token = generateToken(usuario._id);

  return {
    token,
    usuario: sanitizeUser(usuario)
  };
};

const getMe = async (userId) => {
  const usuario = await User.findById(userId).select("-senhaHash");

  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return sanitizeUser(usuario);
};

// Aplica no destino apenas as chaves presentes em source (atualização parcial).
const mergePresent = (target, source, keys) => {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  }
};

const updateMe = async (userId, payload) => {
  const validationError = authValidation.validateUpdateProfilePayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  const usuario = await User.findById(userId);
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  mergePresent(usuario, payload, ["nomeCompleto", "telefone"]);

  if (Object.prototype.hasOwnProperty.call(payload, "cpf")) {
    const cpf = somenteDigitos(payload.cpf);
    if (cpf !== usuario.cpf) {
      if (await User.findOne({ cpf, _id: { $ne: userId } })) {
        throw conflict("CPF já cadastrado", "cpf");
      }
    }
    usuario.cpf = cpf;
  }

  // Subdocumentos aninhados: mesclar campo a campo para não descartar os que
  // não vieram no PATCH (ex.: alterar oab.numero sem reenviar oab.estado).
  if (payload.oab && typeof payload.oab === "object") {
    if (!usuario.oab) usuario.oab = {};
    mergePresent(usuario.oab, payload.oab, ["numero", "estado"]);
    if (Object.prototype.hasOwnProperty.call(payload.oab, "numero")) {
      usuario.oab.numero = somenteDigitos(payload.oab.numero);
    }
    if (Object.prototype.hasOwnProperty.call(payload.oab, "estado") && usuario.oab.estado) {
      usuario.oab.estado = String(usuario.oab.estado).trim().toUpperCase();
    }
    if (await User.findOne({
      "oab.numero": usuario.oab.numero,
      "oab.estado": usuario.oab.estado,
      _id: { $ne: userId }
    })) {
      throw conflict("OAB já cadastrada nesta UF", "oab");
    }
  }

  if (payload.advocacia && typeof payload.advocacia === "object") {
    if (!usuario.advocacia) usuario.advocacia = {};
    mergePresent(usuario.advocacia, payload.advocacia, [
      "nome", "chavePix", "instagram", "site", "logoBase64"
    ]);

    // Remover o logo é mandar null ou "". Guardar a string vazia faria o
    // renderizador tratar "tem logo" como verdadeiro e montar o cabeçalho com
    // uma imagem que não existe.
    //
    // Grava `null`, não `undefined`: a convenção do projeto é que campo apagado
    // vira null. `undefined` some do documento e faz o GET /me devolver a chave
    // ausente em vez de nula, e o frontend não consegue distinguir "logo
    // removido" de "campo que nunca existiu". O renderizador testa por
    // falsidade, então null e undefined lhe são equivalentes.
    if (
      Object.prototype.hasOwnProperty.call(payload.advocacia, "logoBase64") &&
      !payload.advocacia.logoBase64
    ) {
      usuario.advocacia.logoBase64 = null;
    }
  }

  if (payload.endereco && typeof payload.endereco === "object") {
    if (!usuario.endereco) usuario.endereco = {};
    mergePresent(usuario.endereco, payload.endereco, [
      "cep", "pais", "estado", "cidade", "bairro", "logradouro", "numero", "complemento"
    ]);
  }

  try {
    await usuario.save();
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return sanitizeUser(usuario);
};

const changePassword = async (userId, payload) => {
  const validationError = authValidation.validateChangePasswordPayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  const usuario = await User.findById(userId);
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  // A sessão desta requisição é VÁLIDA — `authMiddleware` já a conferiu antes
  // de chegar aqui. O que está errado é o dado enviado, e por isso a resposta
  // é 422 e não 401 (DEC-050). A advogada continua logada: erro de digitação
  // não é motivo para expulsá-la do sistema.
  const senhaValida = await bcrypt.compare(payload.senhaAtual, usuario.senhaHash);
  if (!senhaValida) {
    throw unprocessable("Senha atual incorreta", "senhaAtual");
  }

  usuario.senhaHash = await bcrypt.hash(payload.novaSenha, 10);
  await usuario.save();

  // A-2: um link de recuperação pedido ANTES desta troca não pode valer depois
  // dela — quem o tivesse (e-mail antigo, terceiro) redefiniria por cima da
  // senha que a advogada acabou de escolher. `senhaAlteradaEm` NÃO é escrito
  // aqui: a sessão que trocou a senha continua logada (DEC-050).
  await User.updateOne({ _id: userId }, { $unset: { recuperacaoSenha: "" } });

  return { message: "Senha alterada com sucesso" };
};

// ═══════════════════════════════════════════════════════════════════════════
// A-2 (DEC-064) — CONFIRMAÇÃO DE E-MAIL E RECUPERAÇÃO DE SENHA
// ═══════════════════════════════════════════════════════════════════════════

const INTERVALO_MINIMO_ENVIO_MS = 60 * 1000;

// A MESMA resposta para e-mail com conta, sem conta e em intervalo de espera.
// Escrita numa constante só, para que nenhum ramo possa divergir do outro sem
// que isso apareça numa leitura do arquivo.
export const MENSAGEM_RECUPERACAO =
  "Se o e-mail informado tiver uma conta, enviaremos as instruções para redefinir a senha.";

const MENSAGEM_TOKEN_INVALIDO = "Este link é inválido ou já foi utilizado.";

// Uma finalidade = um campo do usuário + um prazo + uma tela + um e-mail.
const FINALIDADE = Object.freeze({
  confirmacao: {
    campo: "confirmacaoEmail",
    prazoMs: PRAZO_CONFIRMACAO_HORAS * 60 * 60 * 1000,
    caminho: "/confirmar-email",
    montarEmail: montarEmailConfirmacao
  },
  recuperacao: {
    campo: "recuperacaoSenha",
    prazoMs: PRAZO_RECUPERACAO_MINUTOS * 60 * 1000,
    caminho: "/redefinir-senha",
    montarEmail: montarEmailRecuperacao
  }
});

const erroDeToken = (codigo, message) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.codigo = codigo;
  return error;
};

const dentroDoIntervalo = (token, agora = new Date()) =>
  Boolean(token?.enviadoEm) && agora.getTime() - new Date(token.enviadoEm).getTime() < INTERVALO_MINIMO_ENVIO_MS;

// Grava o token novo (que SUBSTITUI o anterior — é isso que invalida o link
// velho) e manda o e-mail. `aguardarEnvio`:
//   true  → resolve só depois do provedor responder, e propaga a falha;
//   false → o envio corre em segundo plano; a falha só é registrada.
// Em qualquer caso o token já está gravado quando o envio começa.
const emitirToken = async ({ usuario, campo, prazoMs, caminho, montarEmail, aguardarEnvio }) => {
  const agora = new Date();
  const { token, tokenHash } = gerarToken(usuario._id);

  await User.updateOne(
    { _id: usuario._id },
    { $set: { [campo]: { tokenHash, expiraEm: new Date(agora.getTime() + prazoMs), enviadoEm: agora } } }
  );

  const enviar = async () => {
    const base = urlBaseDoApp();
    if (!base) {
      const error = new Error("APP_URL não configurada: o link do e-mail não tem endereço");
      error.statusCode = 502;
      throw error;
    }

    const conteudo = montarEmail({
      nomeCompleto: usuario.nomeCompleto,
      link: `${base}${caminho}?token=${token}`
    });
    await enviarEmail({ para: usuario.email, ...conteudo });
  };

  // `enviar()` roda síncrono até o primeiro `await`: a mensagem já foi entregue
  // ao transporte quando esta função retorna, também no modo em segundo plano.
  const envio = enviar();

  if (aguardarEnvio) {
    await envio;
    return;
  }
  envio.catch((error) => registrarFalhaDeEmail(campo, error));
};

// ── Consumo do token: UMA escrita atômica, com o prazo dentro do filtro ─────
//
// O token só é aceito se o hash bate E `expiraEm` ainda está no futuro, tudo na
// MESMA operação que aplica o efeito e apaga o token. Isso dá, de uma vez:
//
//   • uso único — duas requisições simultâneas com o mesmo link: só uma
//     encontra o token, a outra encontra `modifiedCount: 0`;
//   • expiração — vive no filtro, num lugar só. Um "if expirou" antes da
//     escrita seria uma segunda checagem, e é a segunda checagem que fica
//     desatualizada quando alguém mexe na primeira.
//
// O que vem DEPOIS de `modifiedCount: 0` é só diagnóstico: separa "expirou" de
// "não existe/já foi usado" para a tela dizer o que fazer. Não decide nada.
const consumirToken = async ({ campo, token, atualizacao, opcoes, mensagemExpirado }) => {
  const lido = lerToken(token);
  if (!lido) {
    throw erroDeToken("tokenInvalido", MENSAGEM_TOKEN_INVALIDO);
  }

  const agora = new Date();
  const resultado = await User.updateOne(
    {
      _id: lido.usuarioId,
      [`${campo}.tokenHash`]: lido.tokenHash,
      [`${campo}.expiraEm`]: { $gt: agora }
    },
    atualizacao(agora),
    opcoes
  );

  if (resultado.modifiedCount === 1) return;

  const usuario = await User.findById(lido.usuarioId).select(`+${campo}`);
  const guardado = usuario?.[campo];
  if (guardado && hashesIguais(guardado.tokenHash, lido.tokenHash)) {
    throw erroDeToken("tokenExpirado", mensagemExpirado);
  }

  throw erroDeToken("tokenInvalido", MENSAGEM_TOKEN_INVALIDO);
};

const confirmEmail = async (payload) => {
  await consumirToken({
    campo: FINALIDADE.confirmacao.campo,
    token: payload?.token,
    atualizacao: (agora) => ({
      $set: { emailConfirmadoEm: agora },
      $unset: { confirmacaoEmail: "" }
    }),
    mensagemExpirado: "Este link expirou. Entre no sistema e peça um novo e-mail de confirmação."
  });

  return { message: "E-mail confirmado com sucesso" };
};

// Autenticada: a advogada está logada e pede o e-mail para a PRÓPRIA conta, então
// aqui não há o que esconder — diferente da recuperação, esta rota diz o que
// aconteceu (já confirmado, aguarde, falha do provedor).
const resendConfirmation = async (userId) => {
  const usuario = await User.findById(userId).select("+confirmacaoEmail");
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  if (usuario.emailConfirmadoEm) {
    return { message: "Seu e-mail já está confirmado", jaConfirmado: true };
  }

  if (dentroDoIntervalo(usuario.confirmacaoEmail)) {
    const error = new Error("Aguarde um minuto antes de pedir outro e-mail.");
    error.statusCode = 429;
    error.codigo = "aguarde";
    throw error;
  }

  try {
    await emitirToken({ usuario, ...FINALIDADE.confirmacao, aguardarEnvio: true });
  } catch (error) {
    registrarFalhaDeEmail("reenvio de confirmação", error);
    const falha = new Error("Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.");
    falha.statusCode = 502;
    throw falha;
  }

  return { message: "E-mail de confirmação enviado", jaConfirmado: false };
};

// ── Recuperação: a MESMA resposta, aconteça o que acontecer ─────────────────
//
// Existe conta ou não, o envio deu certo ou não, o pedido caiu no intervalo de
// espera ou não: 200 e `MENSAGEM_RECUPERACAO`. É a regra do login (DEC-063)
// aplicada aqui — só que o login esconde a existência da conta por 401
// idêntico, e esta rota a esconde por 200 idêntico.
//
// O formato do e-mail NÃO é validado aqui, pelo mesmo motivo do login: um 400
// só para e-mail malformado separaria "recusei antes de olhar o banco" de
// "olhei". A tela confere o formato (conveniência); o servidor responde igual.
//
// O envio corre em segundo plano para que o TEMPO da resposta também não
// distinga conta existente de inexistente. Resta uma escrita no banco só no
// caminho da conta que existe — diferença de milissegundos, e a rota tem
// limite de tentativas por IP.
const forgotPassword = async (payload) => {
  if (
    payload === null ||
    typeof payload !== "object" ||
    typeof payload.email !== "string" ||
    payload.email.trim() === ""
  ) {
    throw badRequest("E-mail é obrigatório");
  }

  try {
    const usuario = await User.findOne({ email: normalizarEmail(payload.email) })
      .select("+recuperacaoSenha");

    if (usuario && !dentroDoIntervalo(usuario.recuperacaoSenha)) {
      await emitirToken({ usuario, ...FINALIDADE.recuperacao, aguardarEnvio: false });
    }
  } catch (error) {
    // Nem falha de banco pode virar resposta diferente.
    registrarFalhaDeEmail("recuperação de senha", error);
  }

  return { message: MENSAGEM_RECUPERACAO };
};

const resetPassword = async (payload) => {
  const validationError = authValidation.validateResetPasswordPayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  // Hash ANTES de consumir o token, porque a troca da senha, a marca de sessões
  // e o apagamento do token são UMA escrita só.
  const senhaHash = await bcrypt.hash(payload.novaSenha, 10);

  await consumirToken({
    campo: FINALIDADE.recuperacao.campo,
    token: payload.token,
    // Pipeline, e não `$set`: `emailConfirmadoEm` só é preenchido se ainda for
    // nulo. Receber e usar o link de recuperação prova o controle do e-mail —
    // exigir uma segunda confirmação de quem acabou de provar isso seria atrito.
    //
    // `$literal` em `senhaHash` é obrigatório: um hash bcrypt começa com `$`, e
    // numa expressão de agregação uma string assim é lida como CAMINHO DE CAMPO.
    atualizacao: (agora) => [
      {
        $set: {
          senhaHash: { $literal: senhaHash },
          senhaAlteradaEm: agora,
          emailConfirmadoEm: { $ifNull: ["$emailConfirmadoEm", agora] }
        }
      },
      { $unset: ["recuperacaoSenha", "confirmacaoEmail"] }
    ],
    opcoes: { updatePipeline: true },
    mensagemExpirado: "Este link expirou. Peça uma nova redefinição de senha."
  });

  return { message: "Senha redefinida com sucesso. Entre com a nova senha." };
};

export default {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  changePassword,
  confirmEmail,
  resendConfirmation,
  forgotPassword,
  resetPassword
};
