// ═══════════════════════════════════════════════════════════════════════════
// A GRAVAÇÃO ATRASADA NÃO ATROPELA A DE OUTRO APARELHO (F-5b, DEC-060)
//
// ── O caso ──────────────────────────────────────────────────────────────
// Dois aparelhos, um offline. O que ficou sem sinal enfileira uma edição e a
// envia horas depois — e a versão que ele viu é mais VELHA que a que está
// gravada. Sem guarda, a gravação atrasada apaga em silêncio o que o outro
// aparelho escreveu no meio-tempo, e ninguém fica sabendo.
//
// ── A decisão ───────────────────────────────────────────────────────────
// O cliente manda **o `updatedAt` que ele viu**. Se o registro mudou desde
// então, o servidor **recusa com 409** e devolve o que está gravado.
//
// **Não sobrescreve, não mescla, não decide.** Duas versões de um mesmo
// compromisso é conflito de CONTEÚDO, e conteúdo é da advogada — a escolha
// acontece na tela de pendências, com as duas versões à vista.
//
// ── Por que um cabeçalho próprio, e não o `If-Unmodified-Since` do HTTP ──
// O cabeçalho padrão carrega **HTTP-date**, com precisão de SEGUNDOS. Duas
// edições dentro do mesmo segundo passariam pela verificação — e a janela que
// esta guarda existe para fechar é exatamente a de gravações próximas. O
// `X-If-Unmodified-Since` daqui carrega o ISO-8601 completo, com
// milissegundos, que é o que a projeção da API já devolve em `updatedAt`.
//
// ── É IGUALDADE, e não "mais novo que" ──────────────────────────────────
// A pergunta não é "a minha versão é recente o bastante", é **"o registro
// ainda é o que eu vi?"**. Qualquer diferença — para mais ou para menos — quer
// dizer que alguém escreveu no meio, e quem decide o que fazer com isso é
// quem tem as duas versões na tela.
// ═══════════════════════════════════════════════════════════════════════════

export const CABECALHO_VERSAO = "X-If-Unmodified-Since";

// Lido no controller e repassado ao service. O service não conhece `req` —
// é a mesma separação que mantém a regra de sessão fora do `axiosConfig` no
// frontend: quem sabe de HTTP fica na borda.
export const lerVersaoVista = (req) => req.get(CABECALHO_VERSAO) ?? null;

// Função PURA, e é ela que a suíte executa: `"semVerificacao"` quando o
// cliente não mandou nada (o comportamento de antes desta fase), `"invalida"`
// para texto que não é instante, `"igual"` e `"diferente"` para o resto.
export const compararVersao = (atualizadoEm, versaoVista) => {
  if (versaoVista === null || versaoVista === undefined || String(versaoVista).trim() === "") {
    return "semVerificacao";
  }

  const vista = new Date(String(versaoVista).trim()).getTime();
  if (Number.isNaN(vista)) return "invalida";

  const atual = atualizadoEm ? new Date(atualizadoEm).getTime() : NaN;
  if (Number.isNaN(atual)) return "invalida";

  return atual === vista ? "igual" : "diferente";
};

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

// A recusa, com o estado ATUAL do servidor dentro. Sem ele, a tela de
// pendências teria de sair buscando o registro para poder mostrar as duas
// versões — e faria isso logo depois de uma falha de rede, que é o pior
// momento possível para depender de mais uma requisição.
//
// `regra: "conflitoDeVersao"` é a chave estável que o cliente lê; o texto da
// mensagem é para quem chega ao erro sem tratamento próprio.
export const assertVersaoAtual = (registro, versaoVista, projetar, oQueE = "registro") => {
  const veredito = compararVersao(registro?.updatedAt, versaoVista);

  if (veredito === "semVerificacao") return;

  if (veredito === "invalida") {
    throw erro(400, `${CABECALHO_VERSAO} inválido: informe o \`updatedAt\` que você leu.`, {
      campo: CABECALHO_VERSAO
    });
  }

  if (veredito === "diferente") {
    throw erro(
      409,
      `Este ${oQueE} foi alterado em outro aparelho depois que você o abriu.`,
      {
        regra: "conflitoDeVersao",
        errors: {
          atual: projetar ? projetar(registro) : null,
          atualizadoEm: registro?.updatedAt ? new Date(registro.updatedAt).toISOString() : null
        }
      }
    );
  }
};
