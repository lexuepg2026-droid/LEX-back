// Atalhos de arranjo: registrar, logar e montar cenários completos.
//
// Tudo passa pela API, nunca pelo model direto. Um cenário montado por
// `insertMany` testaria um estado que a aplicação talvez nunca produza.

import assert from "node:assert/strict";
import { ClienteApi } from "./client.js";
import {
  dadosUsuario,
  dadosClientePF,
  dadosClientePJ,
  dadosProcesso,
  dadosHonorario,
  dadosParcela,
  dadosPagamento,
  dadosSecao,
  dadosModelo,
  SENHA_PADRAO
} from "./factories.js";

// Falha com o corpo da resposta à vista. Sem isto, um arranjo quebrado aparece
// como `Cannot read properties of null` trinta linhas adiante.
export const esperado = (resposta, status, contexto) => {
  assert.equal(
    resposta.status,
    status,
    `${contexto}: esperado ${status}, veio ${resposta.status} — ` +
    `${JSON.stringify(resposta.body)}`
  );
  return resposta.body;
};

export const registrarUsuario = async (rotulo = "usuário", extra = {}) => {
  const cliente = new ClienteApi(rotulo);
  const payload = dadosUsuario(extra);
  const resposta = await cliente.post("/auth/register", payload);
  esperado(resposta, 201, `registro de ${rotulo}`);
  cliente.usuario = resposta.body.usuario ?? resposta.body;
  cliente.credenciais = { email: payload.email, senha: payload.senha };
  return cliente;
};

export const logar = async (email, senha = SENHA_PADRAO, rotulo = "sessão") => {
  const cliente = new ClienteApi(rotulo);
  const resposta = await cliente.post("/auth/login", { email, senha });
  esperado(resposta, 200, `login de ${rotulo}`);
  cliente.usuario = resposta.body.usuario;
  return cliente;
};

// ── Blocos de cenário ──────────────────────────────────────────────────────

export const criarClientePF = async (api, extra = {}) => {
  const r = await api.post("/clients", dadosClientePF(extra));
  return esperado(r, 201, "criação de cliente PF");
};

export const criarClientePJ = async (api, extra = {}) => {
  const r = await api.post("/clients", dadosClientePJ(extra));
  return esperado(r, 201, "criação de cliente PJ");
};

export const criarProcesso = async (api, clientes, extra = {}) => {
  const r = await api.post("/processes", dadosProcesso(clientes, extra));
  return esperado(r, 201, "criação de processo");
};

export const criarHonorario = async (api, processoId, extra = {}) => {
  const r = await api.post("/fees", dadosHonorario(processoId, extra));
  return esperado(r, 201, "criação de honorário");
};

export const criarParcela = async (api, feeId, numero, extra = {}) => {
  const r = await api.post("/installments", dadosParcela(feeId, numero, extra));
  return esperado(r, 201, `criação de parcela ${numero}`);
};

export const criarPagamento = async (api, installmentId, extra = {}) => {
  const r = await api.post("/payments", dadosPagamento(installmentId, extra));
  return esperado(r, 201, "criação de pagamento");
};

export const criarSecao = async (api, extra = {}) => {
  const r = await api.post("/secoes", dadosSecao(extra));
  return esperado(r, 201, "criação de seção");
};

export const criarModelo = async (api, extra = {}) => {
  const r = await api.post("/documents/modelos", dadosModelo(extra));
  return esperado(r, 201, "criação de modelo");
};

export const vincularSecao = async (api, documentoId, secaoId, ordem) => {
  const corpo = ordem === undefined ? { secaoId } : { secaoId, ordem };
  const r = await api.post(`/documents/${documentoId}/secoes`, corpo);
  return esperado(r, 201, "vínculo de seção");
};

// Cenário completo de um usuário: cliente PF, cliente PJ, processo com os
// dois, honorário, 2 parcelas, 1 pagamento, seção, modelo com a seção
// vinculada, e um documento gerado. É o arranjo que a Parte 3 usa para o
// usuário A e a Parte 5 para os testes de geração.
export const montarCenarioCompleto = async (api, { comDocumentoGerado = true } = {}) => {
  const pf = await criarClientePF(api);
  const pj = await criarClientePJ(api);

  const processo = await criarProcesso(api, [
    { clienteId: pf._id, papel: "autor", principal: true },
    { clienteId: pj._id, papel: "litisconsorte", principal: false }
  ]);

  const honorario = await criarHonorario(api, processo._id);
  const parcela1 = await criarParcela(api, honorario._id, 1);
  const parcela2 = await criarParcela(api, honorario._id, 2);
  const pagamento = await criarPagamento(api, parcela1._id);

  // Texto com variáveis das 3 origens que sempre resolvem num PF completo.
  const secao = await criarSecao(api, {
    titulo: `Qualificação ${Date.now()}${Math.random()}`,
    tipo: "qualificacao",
    texto:
      "{{nomeCliente}}, {{profissaoCliente}}, portadora do CPF {{cpfCliente}}, " +
      "nos autos do processo {{numeroProcesso}}, outorga poderes a " +
      "{{nomeAdvogada}}, OAB/{{estadoOAB}} {{numOAB}}."
  });

  const modelo = await criarModelo(api);
  await vincularSecao(api, modelo._id, secao._id);

  let documento = null;
  if (comDocumentoGerado) {
    const r = await api.post(`/documents/modelos/${modelo._id}/gerar`, {
      processoId: processo._id,
      clienteId: pf._id
    });
    documento = esperado(r, 201, "geração de documento");
  }

  return { pf, pj, processo, honorario, parcela1, parcela2, pagamento, secao, modelo, documento };
};
