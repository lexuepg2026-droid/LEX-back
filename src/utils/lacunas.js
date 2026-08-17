// ═══════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE LACUNAS NO TEXTO GERADO
//
// Lacuna é o espaço que a advogada deixa de propósito para preencher à mão ou
// combinar depois ("o pagamento será feito em [...]"). Não é erro: é aviso.
//
// Diferente de PENDÊNCIA, que é variável do catálogo sem valor no cadastro e
// BLOQUEIA a geração (422). Lacuna nunca bloqueia — nem a geração, nem o
// download. Confundir as duas coisas faria o sistema recusar um documento que
// está exatamente como a advogada quis.
//
// Três formas reconhecidas:
//   [...]        marcador convencional, o recomendado (documentado no README)
//   ___          três ou mais sublinhados — linha para preencher à caneta
//   {{algo}}     chave que sobrou; só aparece se algo escapou do parser, e é
//                o caso mais grave dos três, porque denuncia falha de resolução
// ═══════════════════════════════════════════════════════════════════════════

export const TIPOS_LACUNA = ["colchetes", "sublinhado", "variavel"];

// Ordem importa só para leitura; as três varreduras são independentes e o
// resultado final é reordenado por posição.
const PADROES = [
  // [...] e também [ ... ] ou [qualquer coisa] com reticências dentro.
  { tipo: "colchetes", regex: /\[\s*\.{2,}\s*\]/g, rotulo: "Trecho a preencher" },
  { tipo: "sublinhado", regex: /_{3,}/g, rotulo: "Linha a preencher" },
  { tipo: "variavel", regex: /\{\{\s*[^}]*\}\}/g, rotulo: "Variável não resolvida" }
];

const CONTEXTO = 40;

// Trecho ao redor da ocorrência, com reticências indicando corte. Quebras de
// linha viram espaço: o contexto é para ler numa linha só, na interface.
const extrairContexto = (texto, inicio, fim) => {
  const de = Math.max(0, inicio - CONTEXTO);
  const ate = Math.min(texto.length, fim + CONTEXTO);

  const antes = de > 0 ? "…" : "";
  const depois = ate < texto.length ? "…" : "";

  return (antes + texto.slice(de, ate) + depois).replace(/\s+/g, " ").trim();
};

// Linha (1-based) da posição, para a interface conseguir levar o cursor até lá.
const linhaDaPosicao = (texto, posicao) => {
  let linha = 1;
  for (let i = 0; i < posicao && i < texto.length; i += 1) {
    if (texto[i] === "\n") linha += 1;
  }
  return linha;
};

/**
 * Varre o texto e devolve as lacunas encontradas, ordenadas por posição.
 *
 * Cada item: { tipo, rotulo, trecho, inicio, fim, linha, contexto }
 */
export const detectarLacunas = (texto) => {
  if (typeof texto !== "string" || texto.length === 0) return [];

  const lacunas = [];

  for (const { tipo, regex, rotulo } of PADROES) {
    // `lastIndex` é estado do próprio literal; zerar antes de cada varredura
    // evita que uma chamada anterior faça esta começar do meio do texto.
    regex.lastIndex = 0;

    let ocorrencia = regex.exec(texto);
    while (ocorrencia !== null) {
      const inicio = ocorrencia.index;
      const fim = inicio + ocorrencia[0].length;

      lacunas.push({
        tipo,
        rotulo,
        trecho: ocorrencia[0],
        inicio,
        fim,
        linha: linhaDaPosicao(texto, inicio),
        contexto: extrairContexto(texto, inicio, fim)
      });

      ocorrencia = regex.exec(texto);
    }
  }

  return lacunas.sort((a, b) => a.inicio - b.inicio);
};

// `contarLacunas` foi REMOVIDA na Fase F-0. Era `detectarLacunas(texto).length`
// e não tinha um único chamador: as rotas devolvem `lacunas[]` e quem precisa
// da contagem lê o `.length` do array que já recebeu. Mantê-la convidava a
// varrer o mesmo texto duas vezes — uma para contar, outra para exibir.

export default { detectarLacunas, TIPOS_LACUNA };
