import mongoose from "mongoose";
import Document from "../models/Document.js";
import Client from "../models/Client.js";
import User from "../models/User.js";
import DocumentoSecao from "../models/DocumentoSecao.js";
import Fee from "../models/Fee.js";
import Installment from "../models/Installment.js";
import {
  CATALOGO_VARIAVEIS,
  orientacaoPendencia,
  VARIAVEIS_DE_HONORARIO,
  MOTIVO_PENDENCIA,
  mensagemDePendencias,
  variaveisIncompativeis
} from "../config/templateVariables.js";
import { substituir } from "../utils/templateParser.js";
import formatadores from "../utils/templateFormatters.js";
import { detectarLacunas } from "../utils/lacunas.js";
import { filtroTexto } from "../utils/filtrosDeConsulta.js";
import { buscarVinculoAtivo } from "./processoClienteService.js";
import { assertProcessoAtivoParaCriar } from "./activationHierarchy.js";

const createError = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const assertIdValido = (id, rotulo) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createError(`Identificador de ${rotulo} inválido`, 400);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PONTO ÚNICO DE ACOPLAMENTO COM A MODELAGEM DE CLIENTE DO PROCESSO
//
// Substitui `resolverClientePrincipal`, da Fase 2A, que só sabia ler o cliente
// único de Process. Um documento é assinado por UMA pessoa: dois clientes no
// mesmo processo geram duas procurações, cada uma com a qualificação de quem
// assina. Por isso o cliente agora é explícito.
//
// `clienteId` omitido cai no principal — é o comportamento que mantém as
// chamadas antigas funcionando. Informado, precisa ter vínculo ATIVO com o
// processo: sem essa checagem, a advogada emitiria uma procuração qualificando
// alguém que não é parte, e o vínculo é justamente o que autoriza a peça.
// ═══════════════════════════════════════════════════════════════════════════
export const resolverClienteDoProcesso = async (processo, usuarioId, clienteId) => {
  const principal = processo?.clientePrincipalId?._id ?? processo?.clientePrincipalId;
  const informado = clienteId !== undefined && clienteId !== null && clienteId !== "";

  if (informado && !mongoose.Types.ObjectId.isValid(clienteId)) {
    throw createError("Identificador de cliente inválido", 400);
  }

  const alvo = informado ? clienteId : principal;
  if (!alvo) return null;

  const vinculo = await buscarVinculoAtivo(usuarioId, processo._id, alvo);

  if (!vinculo) {
    // Cliente informado sem vínculo é erro de requisição (400). Principal sem
    // vínculo é inconsistência do processo, e cai no 422 de quem chama —
    // devolver null deixa `carregarContexto` decidir.
    if (informado) {
      throw createError(
        "O cliente informado não está vinculado a este processo. Vincule-o ao processo antes de gerar o documento.",
        400
      );
    }
    return null;
  }

  return Client.findOne({ _id: alvo, usuarioId, ativo: true });
};

// ═══════════════════════════════════════════════════════════════════════════
// QUAL HONORÁRIO ALIMENTA AS VARIÁVEIS DO CONTRATO
//
// Um processo pode ter vários honorários (fase inicial, êxito, custas). O texto
// só fala de um. Escolher errado produz um contrato com o valor de outra
// cobrança — erro que só aparece quando o cliente reclama.
//
// Por isso:
//   informado          → valida que é do processo e está ativo
//   omitido + 1 ativo  → usa esse, sem perguntar (não há ambiguidade)
//   omitido + N ativos → PENDÊNCIA (422) pedindo escolha. Nunca adivinhar:
//                        nem "o mais recente", nem "o de maior valor" — qualquer
//                        critério automático estaria certo por acaso.
//   omitido + 0 ativos → pendência, mas de cadastro: falta criar o honorário.
//
// Nada disso roda se o texto não usa variável de honorário — ver `usaHonorario`
// em `resolver`.
// ═══════════════════════════════════════════════════════════════════════════

// `numeroParcelas` e `valorParcela` são derivados das parcelas ativas, não
// campos do Fee.
const montarOrigemHonorario = async (fee, usuarioId) => {
  const parcelas = await Installment.find({
    feeId: fee._id,
    usuarioId,
    ativo: true
  }).select("valor").sort({ numeroParcela: 1 });

  // Sem parcela cadastrada o honorário é pagamento único: uma parcela do valor
  // cheio. É assim que o contrato deve descrevê-lo, e não como "0 parcelas".
  if (parcelas.length === 0) {
    return {
      _id: fee._id,
      valor: fee.valor,
      tipo: fee.tipo,
      // Fase 4.1: `null` no honorário fixo ou de custas — o formatador devolve
      // "" e a variável vira pendência 422, em vez de um percentual inventado.
      percentual: fee.percentual ?? null,
      dataVencimento: fee.dataVencimento,
      numeroParcelas: 1,
      valorParcela: fee.valor
    };
  }

  const valores = parcelas.map((p) => p.valor);
  const uniformes = valores.every((v) => v === valores[0]);

  return {
    _id: fee._id,
    valor: fee.valor,
    tipo: fee.tipo,
    percentual: fee.percentual ?? null,
    dataVencimento: fee.dataVencimento,
    numeroParcelas: parcelas.length,
    // Parcelas desiguais não têm "valor da parcela" — deixar undefined vira
    // pendência, que é honesto. Dividir o total pelo número produziria um
    // número que não corresponde a nenhuma cobrança real.
    valorParcela: uniformes ? valores[0] : undefined,
    // Fase 4.6: a pendência precisa saber POR QUE o valor não existe. Sem esta
    // marca, "faltou preencher" e "as parcelas divergem" produziriam a mesma
    // frase — e a primeira manda procurar um campo que não existe.
    //
    // Não é campo do Fee e não é lido por mais ninguém: vive só na origem
    // montada para o template, ao lado de `numeroParcelas` e `valorParcela`,
    // que também são derivados.
    parcelasDesiguais: !uniformes
  };
};

// Devolve { honorario, erroDeEscolha }. `erroDeEscolha` não é lançado aqui:
// vira pendência junto com as demais, para a resposta 422 listar tudo de uma vez.
const resolverHonorario = async (processo, usuarioId, honorarioId) => {
  const informado = honorarioId !== undefined && honorarioId !== null && honorarioId !== "";

  if (informado) {
    assertIdValido(honorarioId, "honorário");

    const fee = await Fee.findOne({
      _id: honorarioId,
      usuarioId,
      ativo: true
    });

    if (!fee) {
      throw createError("Honorário não encontrado para este usuário", 400);
    }

    // 400 e não 404: o honorário existe, só não é deste processo. Gerar um
    // contrato com o valor de honorário de outro processo é o erro que esta
    // checagem existe para impedir.
    if (String(fee.processoId) !== String(processo._id)) {
      throw createError(
        "O honorário informado não pertence a este processo",
        400
      );
    }

    return { honorario: await montarOrigemHonorario(fee, usuarioId), erroDeEscolha: null };
  }

  const ativos = await Fee.find({
    processoId: processo._id,
    usuarioId,
    ativo: true
  }).sort({ createdAt: 1 });

  if (ativos.length === 1) {
    return { honorario: await montarOrigemHonorario(ativos[0], usuarioId), erroDeEscolha: null };
  }

  if (ativos.length === 0) {
    return {
      honorario: null,
      erroDeEscolha: {
        variavel: "honorarioId",
        rotulo: "Honorário do processo",
        origem: "honorario",
        orientacao:
          "Este documento usa variáveis de honorário, mas o processo não tem nenhum honorário ativo. Cadastre o honorário antes de gerar."
      }
    };
  }

  return {
    honorario: null,
    erroDeEscolha: {
      variavel: "honorarioId",
      rotulo: "Honorário do processo",
      origem: "honorario",
      orientacao:
        `Este processo tem ${ativos.length} honorários ativos. Informe "honorarioId" para escolher qual deles o documento deve usar.`,
      opcoes: ativos.map((f) => ({
        honorarioId: f._id,
        descricao: f.descricao,
        valor: f.valor,
        tipo: f.tipo,
        dataVencimento: f.dataVencimento
      }))
    }
  };
};

// Leitura por caminho em notação de ponto ("endereco.cidade", "oab.numero").
const lerCaminho = (origem, caminho) => {
  if (!origem || !caminho) return undefined;
  return caminho.split(".").reduce((acc, chave) => {
    if (acc === undefined || acc === null) return undefined;
    // Subdocumento do Mongoose responde a .get(); objeto simples, não.
    return typeof acc.get === "function" && acc.get(chave) !== undefined
      ? acc.get(chave)
      : acc[chave];
  }, origem);
};

// Monta o dicionário {variavel: valorFormatado} a partir do catálogo.
// Só o catálogo decide o que existe — nunca os dados.
export const montarValores = ({ usuario, cliente, processo, honorario, hoje = new Date() }) => {
  const fontes = {
    usuario,
    cliente,
    processo,
    honorario,
    sistema: { hoje }
  };

  const valores = {};

  for (const [nome, def] of Object.entries(CATALOGO_VARIAVEIS)) {
    const fonte = fontes[def.origem];
    const bruto = lerCaminho(fonte, def.caminho);
    const formatador = formatadores[def.formatador] || formatadores.texto;
    valores[nome] = formatador(bruto);
  }

  return valores;
};

// Concatena os textos das seções na ordem, separados por linha em branco.
export const montarTextoDoModelo = (vinculos) =>
  vinculos
    .map((v) => v.secaoId?.texto)
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join("\n\n");

const carregarVinculosOrdenados = (documentoId, usuarioId) =>
  DocumentoSecao.find({ documentoId, usuarioId, ativo: true })
    .populate("secaoId", "titulo tipo texto variaveis")
    .sort({ ordem: 1 });

const carregarContexto = async (processoId, usuarioId, clienteId) => {
  assertIdValido(processoId, "processo");

  // ── DEC-053 alcança Documento (F-2d) ────────────────────────────────────
  //
  // Gerar uma peça num processo arquivado CRIA um documento ativo sob pai
  // inativo — é a boca 2 da regra, pela terceira porta do módulo (as outras
  // duas são `createDocumentService` e a mudança de `processoId` no PATCH).
  //
  // Já era recusado, com o `findOne({ ativo: true })` que vivia aqui. O que
  // muda é o PORQUÊ: 404 "não encontrado" virou 409 nomeando o processo.
  //
  // Vale também para o PREVIEW, que passa por esta mesma função: pré-visualizar
  // não grava nada, mas oferecer a prévia de uma peça que a geração recusaria
  // é levar a advogada até o último clique para então dizer não.
  const processo = await assertProcessoAtivoParaCriar(usuarioId, processoId, "gerar o documento");

  const cliente = await resolverClienteDoProcesso(processo, usuarioId, clienteId);
  if (!cliente) {
    throw createError("O processo não tem cliente ativo vinculado", 422);
  }

  const usuario = await User.findById(usuarioId);
  if (!usuario) {
    throw createError("Usuário não encontrado", 404);
  }

  return { processo, cliente, usuario };
};


// ═══════════════════════════════════════════════════════════════════════════
// PENDÊNCIA DETALHADA — os becos sem saída do módulo (Fase 4.6)
//
// `orientacaoPendencia` resolve o que o CATÁLOGO sabe: campo vazio e
// incompatibilidade de tipo de pessoa. Os dois casos abaixo dependem do que só
// o resolvedor sabe — o tipo do honorário e a forma das parcelas —, e eram
// justamente as duas orientações que mandavam a advogada a lugar nenhum.
// ═══════════════════════════════════════════════════════════════════════════
const detalharPendencia = (nome, contexto = {}) => {
  const base = orientacaoPendencia(nome, contexto);

  // ── 2.2 — `percentualHonorario` num honorário que não admite percentual ──
  //
  // Antes: "Preencha 'Percentual do honorário' no honorário vinculado ao
  // processo". Seguir isso ao pé da letra devolve **400**: o hook do Fee recusa
  // percentual fora do tipo percentual ("Honorário do tipo fixo não admite
  // percentual"). A advogada ia ao honorário, digitava, era recusada, e não
  // tinha como saber que o caminho era trocar o TIPO da cobrança.
  if (nome === "percentualHonorario" && contexto.tipoHonorario &&
      contexto.tipoHonorario !== "percentual") {
    const rotulo = contexto.tipoHonorario === "custas" ? "custas processuais" : contexto.tipoHonorario;
    return {
      ...base,
      motivo: MOTIVO_PENDENCIA.TIPO_HONORARIO_INCOMPATIVEL,
      tipoHonorario: contexto.tipoHonorario,
      causa: `O honorário deste processo é do tipo ${rotulo}, que não tem percentual.`,
      orientacao:
        `O honorário deste processo é do tipo ${rotulo}. ` +
        "Mude o tipo para percentual (informando percentual e valor base) em " +
        "Honorários, ou remova a variável da seção."
    };
  }

  // ── 2.3 — `valorParcela` com parcelas de valores diferentes ─────────────
  //
  // Antes: "Preencha 'Valor da parcela' no honorário vinculado ao processo".
  // **Não existe campo "Valor da parcela" no honorário** — o valor mora em cada
  // parcela, e a pendência aparece justamente porque elas DIVERGEM. A frase
  // mandava procurar um campo inexistente para resolver um problema que não é
  // de preenchimento.
  if (nome === "valorParcela" && contexto.parcelasDesiguais) {
    return {
      ...base,
      motivo: MOTIVO_PENDENCIA.PARCELAS_DESIGUAIS,
      causa: "As parcelas deste honorário têm valores diferentes entre si.",
      orientacao:
        "As parcelas deste honorário têm valores diferentes, então não existe " +
        "um \"valor da parcela\" único para escrever no documento. Deixe as parcelas " +
        "com o mesmo valor em Parcelas, ou remova a variável da seção."
    };
  }

  return base;
};

// Resolve o texto do modelo para um processo, SEM persistir nada.
const resolver = async (modelo, processoId, usuarioId, { clienteId, honorarioId } = {}) => {
  const vinculos = await carregarVinculosOrdenados(modelo._id, usuarioId);

  if (vinculos.length === 0) {
    // Fase 4.6 (item 2.5): ganha corpo `errors`, como os demais 422 do módulo.
    // A tela de montagem já previne (o botão fica desabilitado e há aviso), mas
    // quem chama a API crua recebia um 422 sem `errors` — o único do módulo
    // fora do formato, e o frontend tem de tratar dois formatos por causa dele.
    throw createError(
      "O modelo não possui seções vinculadas",
      422,
      {
        errors: {
          pendencias: [{
            variavel: "secoes",
            rotulo: "Seções do modelo",
            origem: null,
            motivo: MOTIVO_PENDENCIA.CAMPO_VAZIO,
            causa: "O modelo não tem nenhuma seção vinculada.",
            orientacao:
              "Acrescente ao menos uma seção ao modelo, na tela de montagem, antes de gerar."
          }]
        }
      }
    );
  }

  const { processo, cliente, usuario } = await carregarContexto(
    processoId,
    usuarioId,
    clienteId
  );

  const textoModelo = montarTextoDoModelo(vinculos);

  // Só cobra a escolha do honorário se o texto realmente usa alguma variável de
  // honorário. Uma procuração não fala de valores — pedir `honorarioId` nela
  // seria burocracia inventada.
  const usaHonorario = VARIAVEIS_DE_HONORARIO.some((nome) =>
    textoModelo.includes(`{{${nome}}}`)
  );

  let honorario = null;
  let erroDeEscolha = null;

  if (usaHonorario) {
    ({ honorario, erroDeEscolha } = await resolverHonorario(processo, usuarioId, honorarioId));
  }

  const valores = montarValores({ usuario, cliente, processo, honorario });
  const { texto, pendencias } = substituir(textoModelo, valores);

  // ── Contexto das pendências (Fase 4.6) ─────────────────────────────────
  //
  // O catálogo sozinho só sabe dizer "preencha". Quem sabe que o cliente é PF,
  // que o honorário é fixo ou que as parcelas são desiguais é este resolvedor —
  // e sem passar isso adiante, três das sete mensagens do módulo continuariam
  // apontando ações impossíveis.
  const contexto = {
    tipoPessoaCliente: cliente?.tipoPessoa ?? null,
    nomeCliente: cliente?.nomeCompleto || cliente?.razaoSocial || null,
    tipoHonorario: honorario?.tipo ?? null,
    parcelasDesiguais: honorario?.parcelasDesiguais === true
  };

  const orientadas = pendencias.map((nome) => detalharPendencia(nome, contexto));

  // A escolha do honorário entra ANTES das demais: sem ela, todas as variáveis
  // de honorário também estão pendentes, e a lista começaria pelo sintoma em
  // vez da causa.
  const todasPendencias = erroDeEscolha ? [erroDeEscolha, ...orientadas] : orientadas;

  return {
    processo,
    cliente,
    honorario,
    // Id efetivamente usado — pode ter sido resolvido sozinho, quando o
    // processo tinha um único honorário ativo. É ele que o Document grava.
    honorarioId: honorario?._id ?? null,
    vinculos,
    valores,
    textoResolvido: texto,
    pendencias: todasPendencias,
    // Lacuna é aviso, não impedimento: acompanha a resposta e nunca bloqueia.
    lacunas: detectarLacunas(texto)
  };
};

export const criarModeloService = async (usuarioId, payload) => {
  // ehModelo e origem são impostos aqui; processoId enviado é ignorado pelo
  // hook do schema — modelo não pertence a processo.
  const modelo = await Document.create({
    usuarioId,
    nome: payload.nome,
    tipo: payload.tipo,
    descricao: payload.descricao,
    ehModelo: true,
    origem: "gerado"
  });

  return modelo;
};

export const listarModelosService = async (usuarioId, { page = 1, limit = 20, tipo } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true, ehModelo: true };
  // Guarda de tipo (Fase F-0): era `if (tipo)`, sem checagem nenhuma — o único
  // filtro do módulo de documentos que a 4.5 não alcançou.
  const tipoFiltro = filtroTexto(tipo);
  if (tipoFiltro) filter.tipo = tipoFiltro;

  const [data, total] = await Promise.all([
    Document.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Document.countDocuments(filter)
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const carregarModelo = async (modeloId, usuarioId) => {
  assertIdValido(modeloId, "modelo");

  const modelo = await Document.findOne({
    _id: modeloId,
    usuarioId,
    ativo: true,
    ehModelo: true
  });

  if (!modelo) {
    throw createError("Modelo não encontrado", 404);
  }

  return modelo;
};

// "O mesmo documento" é a combinação modelo + processo + cliente: é ela que
// produz texto idêntico. Regerar para outro cliente do mesmo processo é
// documento novo, não sobrescrita — foi o que a Fase 2B passou a permitir.
const buscarGeradoAnterior = (usuarioId, modeloId, processoId, clienteId) =>
  Document.findOne({
    usuarioId,
    geradoDeModeloId: modeloId,
    processoId,
    clienteId,
    ehModelo: false,
    ativo: true
  }).sort({ dataGeracao: -1 });

export const gerarDocumentoService = async (
  modeloId,
  usuarioId,
  { processoId, clienteId, honorarioId, confirmarSobrescrita } = {}
) => {
  if (!processoId) {
    throw createError("processoId é obrigatório para gerar o documento", 400);
  }

  const modelo = await carregarModelo(modeloId, usuarioId);
  const {
    cliente,
    vinculos,
    valores,
    textoResolvido,
    pendencias,
    honorarioId: honorarioUsadoId
  } = await resolver(modelo, processoId, usuarioId, { clienteId, honorarioId });

  // Documento incompleto não é gerado: preferimos recusar a produzir uma peça
  // com lacuna que só apareceria na leitura do juiz.
  if (pendencias.length > 0) {
    // A frase do topo acompanha o motivo dominante (Fase F-0). Com pendências
    // de motivos diferentes, volta a ser a genérica — ver `mensagemDePendencias`.
    throw createError(mensagemDePendencias(pendencias), 422, { errors: { pendencias } });
  }

  // Regerar por cima de um texto que a advogada revisou à mão descarta o
  // trabalho dela sem aviso — e a revisão é justamente a parte que o sistema
  // não sabe refazer. Exige confirmação explícita.
  const anterior = await buscarGeradoAnterior(usuarioId, modelo._id, processoId, cliente._id);

  if (anterior?.editadoManualmente === true && confirmarSobrescrita !== true) {
    // ── O aviso do portal (Fase 3.1) ────────────────────────────────────────
    // Documento novo nasce com `visivelPortal: false` (decisão de segurança do
    // model, mantida de propósito), e não existe rota que leia documento
    // inativo. Logo, regerar um documento que ESTAVA visível o faz DESAPARECER
    // do portal do cliente — em silêncio, do ponto de vista da advogada.
    //
    // O comportamento não muda: default `false` continua sendo a escolha certa,
    // porque a alternativa é uma peça nova aparecer para o cliente sem ninguém
    // ter liberado. O que muda é que ele deixa de ser invisível: a resposta
    // passa a dizer que o anterior estava no portal, para a tela poder avisar
    // "este documento sairá do portal até você liberar o novo".
    //
    // `visivelPortal` está na allowlist de `CHAVES_ESTRUTURADAS` do
    // `errorHandler`; sem isso a chave não chegaria ao cliente.
    throw createError(
      "Este documento já foi gerado e editado manualmente. Regerar vai substituir o texto revisado. Envie \"confirmarSobrescrita\": true para prosseguir.",
      409,
      {
        visivelPortal: anterior.visivelPortal === true,
        errors: {
          documentoId: anterior._id,
          dataGeracao: anterior.dataGeracao,
          editadoManualmente: true,
          // Se o anterior estava visível, o novo NÃO nasce visível: a advogada
          // precisa liberar de novo.
          sairaDoPortal: anterior.visivelPortal === true
        }
      }
    );
  }

  const gerado = await Document.create({
    usuarioId,
    processoId,
    // De qual participante saiu esta peça. Sem isso, duas procurações do mesmo
    // modelo e processo — uma por litisconsorte — ficam indistinguíveis na
    // listagem: mesmo nome, mesmo tipo, mesma data.
    clienteId: cliente._id,
    // De qual honorário saíram os valores do texto. Null quando o documento não
    // usa variável de honorário — uma procuração não fala de dinheiro.
    honorarioId: honorarioUsadoId,
    nome: modelo.nome,
    tipo: modelo.tipo,
    descricao: modelo.descricao,
    origem: "gerado",
    ehModelo: false,
    // Congelado: o texto e os valores usados ficam gravados e não acompanham
    // alterações posteriores no cadastro do cliente.
    textoResolvido,
    variaveisResolvidas: valores,
    dataGeracao: new Date(),
    geradoDeModeloId: modelo._id
  });

  // Confirmada a sobrescrita, o anterior sai de cena por soft delete. Mantê-lo
  // ativo faria a listagem exibir duas versões do mesmo documento sem dizer
  // qual vale; o soft delete preserva o texto revisado caso tenha sido engano.
  //
  // Acontece DEPOIS da criação, e não antes, porque `substituidoPorId` precisa
  // do _id do documento novo. É essa referência que mantém a cadeia navegável:
  // o texto que a advogada revisou à mão continua recuperável e diz para onde
  // a versão vigente foi.
  if (anterior && confirmarSobrescrita === true) {
    anterior.ativo = false;
    anterior.substituidoPorId = gerado._id;
    await anterior.save();
  }

  // Replica a composição, para o documento gerado saber de quais seções veio.
  if (vinculos.length > 0) {
    await DocumentoSecao.insertMany(
      vinculos.map((v, i) => ({
        usuarioId,
        documentoId: gerado._id,
        secaoId: v.secaoId?._id ?? v.secaoId,
        ordem: i + 1
      }))
    );
  }

  return gerado;
};


// ═══════════════════════════════════════════════════════════════════════════
// AVISO PREVENTIVO DE COMPATIBILIDADE (Fase 4.6, item 1.3)
//
// Responde "este modelo serve para este cliente?" ANTES de gerar, para a tela
// avisar no momento em que a advogada escolhe o cliente — e não depois, num 422
// que ela recebe achando que só faltava preencher alguma coisa.
//
// Devolve as seções culpadas junto com as variáveis: saber QUE há incompatível
// não basta para agir; é preciso saber ONDE, e a advogada pensa em seções, não
// em chaves de template.
//
// Não gera nada e não persiste nada — é leitura, e responde 200 mesmo quando o
// resultado é "não serve". Recusar aqui seria transformar um aviso em bloqueio,
// e gerar continua permitido: o 422 é a rede, este é o alerta.
// ═══════════════════════════════════════════════════════════════════════════
export const compatibilidadeService = async (modeloId, usuarioId, { clienteId } = {}) => {
  const modelo = await carregarModelo(modeloId, usuarioId);

  assertIdValido(clienteId, "cliente");
  const cliente = await Client.findOne({ _id: clienteId, usuarioId, ativo: true });
  if (!cliente) {
    throw createError("Cliente não encontrado para este usuário", 404);
  }

  const vinculos = await carregarVinculosOrdenados(modelo._id, usuarioId);

  const secoes = [];
  const todas = new Set();

  for (const vinculo of vinculos) {
    const secao = vinculo.secaoId;
    if (!secao) continue;

    const incompativeis = variaveisIncompativeis(secao.variaveis ?? [], cliente.tipoPessoa);
    if (incompativeis.length === 0) continue;

    for (const nome of incompativeis) todas.add(nome);
    secoes.push({
      secaoId: secao._id,
      titulo: secao.titulo,
      variaveis: incompativeis.map((nome) => ({
        variavel: nome,
        rotulo: CATALOGO_VARIAVEIS[nome]?.rotulo ?? nome,
        tipoVariavel: CATALOGO_VARIAVEIS[nome]?.tipoCliente ?? null
      }))
    });
  }

  return {
    modeloId: modelo._id,
    clienteId: cliente._id,
    tipoPessoaCliente: cliente.tipoPessoa,
    nomeCliente: cliente.nomeCompleto || cliente.razaoSocial || null,
    compativel: todas.size === 0,
    totalVariaveis: todas.size,
    secoes
  };
};

export const previewDocumentoService = async (
  documentoId,
  usuarioId,
  { processoId, clienteId, honorarioId } = {}
) => {
  assertIdValido(documentoId, "documento");

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Documento já gerado devolve o texto congelado — é o que vale juridicamente.
  if (!documento.ehModelo && documento.textoResolvido) {
    return {
      documentoId: documento._id,
      ehModelo: false,
      congelado: true,
      dataGeracao: documento.dataGeracao,
      editadoManualmente: documento.editadoManualmente === true,
      textoResolvido: documento.textoResolvido,
      pendencias: [],
      // Lacunas do texto congelado: é nele que a advogada precisa enxergar o
      // que ficou por preencher, não no modelo.
      lacunas: detectarLacunas(documento.textoResolvido)
    };
  }

  if (!documento.ehModelo) {
    throw createError(
      "Documento não é modelo e não possui texto gerado para pré-visualizar",
      400
    );
  }

  if (!processoId) {
    throw createError(
      "Informe processoId na query para pré-visualizar um modelo",
      400
    );
  }

  const { textoResolvido, pendencias, lacunas, cliente, processo, honorarioId: honorarioUsadoId } =
    await resolver(documento, processoId, usuarioId, { clienteId, honorarioId });

  // Preview NÃO persiste: é só leitura, inclusive quando há pendências.
  return {
    documentoId: documento._id,
    ehModelo: true,
    congelado: false,
    processoId: processo._id,
    clienteId: cliente._id,
    honorarioId: honorarioUsadoId,
    textoResolvido,
    pendencias,
    lacunas
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// EDIÇÃO MANUAL DO TEXTO FINAL
//
// Depois de gerado, `textoResolvido` é a ÚNICA fonte da verdade do documento.
// Os vínculos de seção permanecem, mas viram rastreabilidade de origem — nunca
// mais são recompostos para produzir o texto. Se fossem, a edição da advogada
// sumiria no próximo download, silenciosamente.
// ═══════════════════════════════════════════════════════════════════════════
export const atualizarTextoService = async (documentoId, usuarioId, textoResolvido) => {
  assertIdValido(documentoId, "documento");

  if (typeof textoResolvido !== "string" || textoResolvido.trim().length === 0) {
    throw createError("textoResolvido é obrigatório e não pode ser vazio", 400);
  }

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Modelo é peça de composição: o texto dele vem das seções, e editá-lo aqui
  // criaria uma segunda fonte da verdade para o mesmo modelo.
  if (documento.ehModelo) {
    throw createError(
      "Modelo não tem texto final editável. Edite as seções que o compõem.",
      400
    );
  }

  // Upload é arquivo anexado, não texto gerado — não há o que editar.
  if (documento.origem !== "gerado" || !documento.dataGeracao) {
    throw createError(
      "Apenas documentos gerados possuem texto final editável",
      400
    );
  }

  documento.textoResolvido = textoResolvido;
  documento.editadoManualmente = true;
  await documento.save();

  return {
    documentoId: documento._id,
    editadoManualmente: true,
    textoResolvido: documento.textoResolvido,
    lacunas: detectarLacunas(documento.textoResolvido)
  };
};

export const alternarVisibilidadePortalService = async (documentoId, usuarioId, visivelPortal) => {
  assertIdValido(documentoId, "documento");

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Modelo é peça interna de trabalho: nunca vai para o portal do cliente.
  if (documento.ehModelo) {
    throw createError("Modelo não pode ser exibido no portal do cliente", 400);
  }

  // Upload também não: o portal da Fase 3 serve o texto gerado pelo sistema, e
  // o arquivo anexado não passou pela conferência de pendências que garante que
  // não há campo vazio no meio da peça. Liberar upload para o cliente é decisão
  // de outra fase, com outra tela.
  if (documento.origem !== "gerado" || !documento.dataGeracao) {
    throw createError(
      "Apenas documentos gerados podem ser exibidos no portal do cliente",
      400
    );
  }

  documento.visivelPortal =
    typeof visivelPortal === "boolean" ? visivelPortal : !documento.visivelPortal;

  await documento.save();

  return documento;
};

export default {
  resolverClienteDoProcesso,
  compatibilidadeService,
  montarValores,
  montarTextoDoModelo,
  criarModeloService,
  listarModelosService,
  gerarDocumentoService,
  previewDocumentoService,
  atualizarTextoService,
  alternarVisibilidadePortalService
};
