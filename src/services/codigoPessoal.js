// ═══════════════════════════════════════════════════════════════════════════
// O CÓDIGO PESSOAL DO PORTAL — geração e unicidade nos DOIS espaços
// (Fase 2.5, DEC-089 e DEC-090)
//
// Existem dois espaços de código no formato LEX-XXXX-XXXX:
//
//   `clients.codigoAcessoPessoal`        — a credencial de login, desde a 2.5
//   `processo_clientes.codigoAcesso`     — o código de vínculo, que deixou de
//                                          autenticar e continua RESERVADO
//
// Cada coleção tem índice único próprio, e índice não atravessa coleção. A
// unicidade ENTRE os dois é garantida aqui: todo código novo, de qualquer dos
// dois espaços, só é aceito se não existir em NENHUM. Os dois geradores do
// sistema passam por `codigoEmUso` — este, e `gerarCodigoParaVinculo` em
// `processoClienteService.js`.
//
// ── A janela de corrida, dita por extenso ────────────────────────────────
// Entre a consulta e a gravação, outra requisição poderia gravar o mesmo
// candidato no OUTRO espaço, e nenhum índice pegaria. A probabilidade é a de
// sortear duas vezes o mesmo entre 32^8 (~1,1 trilhão) códigos no mesmo
// milissegundo. E o efeito, se acontecesse, é inofensivo: o login só procura
// em `codigoAcessoPessoal` (DEC-090), então um código de vínculo igual a um
// pessoal não abre nada. Dentro do MESMO espaço a corrida é fechada pelo
// índice, e o 11000 é tratado repetindo a geração (`salvarClienteComCodigo`).
// ═══════════════════════════════════════════════════════════════════════════

import Client from "../models/Client.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import { gerarCodigoAcessoUnico, TENTATIVAS_PADRAO } from "../utils/accessCode.js";

export const codigoEmUso = async (candidato, session = null) =>
  Boolean(await Client.exists({ codigoAcessoPessoal: candidato }).session(session)) ||
  Boolean(await ProcessoCliente.exists({ codigoAcesso: candidato }).session(session));

export const gerarCodigoPessoal = (session = null) =>
  gerarCodigoAcessoUnico((candidato) => codigoEmUso(candidato, session), TENTATIVAS_PADRAO);

// O cliente passa a ter senha de portal e ainda não tem código: ganha um. Quem
// já tem mantém o mesmo — redefinir a senha não troca o código que a pessoa
// já anotou.
export const garantirCodigoPessoal = async (client, session = null) => {
  if (!client.codigoAcessoPessoal) {
    client.codigoAcessoPessoal = await gerarCodigoPessoal(session);
  }
  return client.codigoAcessoPessoal;
};

export const ehColisaoDeCodigoPessoal = (error) =>
  error?.code === 11000 && Boolean(error?.keyPattern?.codigoAcessoPessoal);

// `save()` que sobrevive à corrida dentro do espaço pessoal: se o índice
// recusar o código, sorteia outro e tenta de novo. Qualquer outro erro sobe
// como veio (o 409 de CPF duplicado continua sendo o 409 de CPF duplicado).
export const salvarClienteComCodigo = async (client, tentativas = TENTATIVAS_PADRAO) => {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await client.save();
    } catch (error) {
      if (!ehColisaoDeCodigoPessoal(error) || tentativa >= tentativas) throw error;
      client.codigoAcessoPessoal = await gerarCodigoPessoal();
    }
  }
};

export default {
  codigoEmUso, gerarCodigoPessoal, garantirCodigoPessoal,
  ehColisaoDeCodigoPessoal, salvarClienteComCodigo
};
