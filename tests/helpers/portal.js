// Atalhos de arranjo do portal do cliente.
//
// Monta o cenário mínimo que quase todo teste do portal precisa: uma advogada,
// um cliente com senha de portal, um processo com o vínculo, e o código de
// acesso já em mãos.
//
// O código de acesso sai da rota dedicada, como em produção — nunca do banco.
// Ler o código direto da coleção esconderia uma regressão inteira: se
// `GET /clientes/:cid/codigo-acesso` quebrar, o teste do portal precisa cair
// junto, porque sem essa rota a advogada não tem como entregar o código.

import { ClienteApi } from "./client.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, esperado
} from "./setup.js";
import { dadosClientePF } from "./factories.js";

export const SENHA_PROVISORIA = "Provisoria123";
export const SENHA_DO_CLIENTE = "MinhaSenha456";

// Cliente HTTP com pote de cookies próprio, para o portal. Cada instância é uma
// sessão independente — é o que sustenta os testes de isolamento entre dois
// vínculos e entre os dois domínios.
export const novoClientePortal = (rotulo = "portal") => new ClienteApi(rotulo);

// Desde a Fase 2.5 (DEC-093) a rota devolve o código PESSOAL do cliente — o
// único que autentica. O nome do helper ficou: é a pergunta da advogada
// ("qual código eu entrego?"), e a resposta mudou junto com o modelo.
export const codigoAcessoDe = async (api, processoId, clienteId) => {
  const r = esperado(
    await api.get(`/processes/${processoId}/clientes/${clienteId}/codigo-acesso`),
    200,
    "código de acesso"
  );
  return r.codigoAcesso;
};

// O código de VÍNCULO, que não autentica mais e continua reservado (DEC-090).
// Nenhuma rota o devolve; a suíte lê do banco para provar que ele é recusado.
export const codigoDeVinculoDe = async (processoId, clienteId) => {
  const { default: ProcessoCliente } = await import("../../src/models/ProcessoCliente.js");
  const v = await ProcessoCliente.findOne({ processoId, clienteId, ativo: true }).select("codigoAcesso");
  return v?.codigoAcesso ?? null;
};

// Vínculo novo nasce NÃO liberado (DEC-091): o cenário de portal libera.
export const liberarNoPortal = async (api, processoId, clienteId, liberadoNoPortal = true) =>
  esperado(
    await api.patch(`/processes/${processoId}/clientes/${clienteId}/liberacao`, { liberadoNoPortal }),
    200,
    "liberação no portal"
  );

// Cenário base: advogada + cliente com senha provisória + processo + código.
export const montarCenarioPortal = async (rotulo = "adv-portal", extraCliente = {}) => {
  const adv = await registrarUsuario(rotulo);

  const cliente = esperado(
    await adv.post("/clients", {
      ...dadosClientePF(extraCliente),
      senhaPortal: SENHA_PROVISORIA
    }),
    201,
    "cliente com senha de portal"
  );

  const processo = await criarProcesso(adv, [
    { clienteId: cliente._id, papel: "autor", principal: true }
  ]);

  await liberarNoPortal(adv, processo._id, cliente._id);
  const codigoAcesso = await codigoAcessoDe(adv, processo._id, cliente._id);

  return { adv, cliente, processo, codigoAcesso, senha: SENHA_PROVISORIA };
};

// Loga no portal e devolve a sessão. Não troca a senha — quem quiser a sessão
// já "madura" usa `entrarNoPortalComSenhaPropria`.
export const entrarNoPortal = async (codigoAcesso, senha = SENHA_PROVISORIA, rotulo = "portal") => {
  const api = novoClientePortal(rotulo);
  const r = await api.post("/portal/login", { codigoAcesso, senha });
  esperado(r, 200, `login no portal (${rotulo})`);
  api.senhaPortalProvisoria = r.body.senhaPortalProvisoria;
  return api;
};

// Sessão com a senha já trocada pelo cliente — o estado em que o portal libera
// tudo e a confirmação de visualização passa a valer como recibo.
export const entrarNoPortalComSenhaPropria = async (
  codigoAcesso,
  { provisoria = SENHA_PROVISORIA, propria = SENHA_DO_CLIENTE, rotulo = "portal" } = {}
) => {
  const api = await entrarNoPortal(codigoAcesso, provisoria, rotulo);
  esperado(
    await api.patch("/portal/senha", { senhaAtual: provisoria, novaSenha: propria }),
    200,
    "troca de senha do portal"
  );
  api.senhaPortalProvisoria = false;
  return api;
};

// Cenário completo e pronto para uso: cliente já com senha própria.
export const montarPortalPronto = async (rotulo = "adv-portal") => {
  const base = await montarCenarioPortal(rotulo);
  const portal = await entrarNoPortalComSenhaPropria(base.codigoAcesso, { rotulo: `${rotulo}-sessao` });
  return { ...base, portal, senha: SENHA_DO_CLIENTE };
};

export default {
  liberarNoPortal,
  codigoDeVinculoDe,
  montarCenarioPortal,
  montarPortalPronto,
  entrarNoPortal,
  entrarNoPortalComSenhaPropria,
  codigoAcessoDe,
  novoClientePortal
};
