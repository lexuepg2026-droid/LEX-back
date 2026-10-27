import User from "../models/User.js";
import { renderizarPdf } from "./documentRenderService.js";
import { nomeArquivoSeguro } from "./letterheadService.js";

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLO DO TIMBRADO — Fase 3.6 (DEC-126)
//
// Uma folha de exemplo para o perfil da advogada: o timbrado com os dados
// SALVOS dela e um parágrafo curto no corpo.
//
// Sai por `renderizarPdf`, o MESMO caminho do download de documento — o
// cabeçalho, o rodapé, as margens e as fontes são as de `letterheadService.js`,
// que o recibo também usa. Montar uma folha própria aqui, ou desenhar o
// timbrado em HTML na tela, seria uma segunda regra para o mesmo papel: a
// prévia divergiria do documento real na primeira fase que mexesse num dos
// dois, e a advogada confiaria justamente na prévia.
//
// Nada é gravado: como o recibo, é emissão sob demanda. E não há parâmetro
// nenhum — o usuário é o da sessão, e só ele (isolamento por construção).
// ═══════════════════════════════════════════════════════════════════════════

export const TEXTO_EXEMPLO_TIMBRADO =
  "Este é um exemplo de como o seu timbrado aparece nos documentos e recibos.";

export const emitirExemploTimbrado = async (usuarioId) => {
  const usuario = await User.findById(usuarioId);
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const buffer = await renderizarPdf({ textoResolvido: TEXTO_EXEMPLO_TIMBRADO, usuario });

  return {
    buffer,
    contentType: "application/pdf",
    nomeArquivo: nomeArquivoSeguro(["exemplo-timbrado", usuario.advocacia?.nome], "pdf")
  };
};

export default { emitirExemploTimbrado, TEXTO_EXEMPLO_TIMBRADO };
