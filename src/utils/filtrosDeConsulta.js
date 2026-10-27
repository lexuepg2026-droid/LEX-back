import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// GUARDAS DE TIPO NOS FILTROS DE QUERY STRING (achado #3 — Fase 4.5)
//
// ── O que a Fase 4.5 MEDIU antes de corrigir ──────────────────────────────
// Contra a base do seed, com o servidor de pé:
//
//     GET /api/secoes?tipo=clausula        → total 3    (o filtro funciona)
//     GET /api/secoes?tipo[$ne]=clausula   → total 11   (o operador foi IGNORADO)
//
// Ou seja: **não havia injeção ativa**. O Express 5 usa o query parser
// "simple" por padrão, que não monta objeto aninhado — `tipo[$ne]` chega como
// uma CHAVE LITERAL de nome `"tipo[$ne]"`, e `req.query.tipo` fica `undefined`.
// O filtro é descartado, não interpretado.
//
// ── Então por que corrigir ────────────────────────────────────────────────
// Porque a proteção é do FRAMEWORK, não do código. Uma linha
// `app.set("query parser", "extended")` — que alguém acrescenta no dia em que
// precisar de um filtro aninhado legítimo — devolve o objeto aninhado e
// transforma os filtros em injeção de operador de uma vez, sem que nenhum
// teste existente caia. Depender de um default para não vazar dado de outro
// usuário é apostar que ninguém vai mexer numa linha de configuração.
//
// ── O que a Fase F-0 acrescentou ──────────────────────────────────────────
// A 4.5 aplicou a guarda em QUATRO filtros. Os outros oito repetiam a regra à
// mão (`typeof x === "string"`) ou não tinham guarda nenhuma, e dois deles
// chamavam `ObjectId.isValid` ANTES do `typeof` — exatamente a ordem que o
// comentário de `filtroObjectId` existe para proibir. A auditoria de retomada
// mediu a consequência: o MESMO parâmetro inválido tinha quatro
// comportamentos diferentes.
//
//     GET /documents?processoId=xyz     → 200, total 19  (filtro descartado)
//     GET /fees?processoId=xyz          → 200, total 12  (idem)
//     GET /installments?processoId=xyz  → 200, total 0   (lista vazia)
//     GET /payments?processoId=xyz      → 200, total 0   (idem)
//
// Os dois primeiros são o pior: um id torto vindo da tela mostra a base
// INTEIRA no lugar do recorte pedido, e nada na resposta diz que o filtro não
// foi aplicado. Os dois últimos mentem ao contrário — "não há nada aqui".
//
// **MUDANÇA DE CONTRATO DELIBERADA (Fase F-0):** id malformado agora responde
// **400 com `campo`**, nos quatro módulos. É erro do chamador, e a única
// resposta honesta é dizer qual campo veio errado — as outras três alternativas
// (ignorar, esvaziar, adivinhar) inventam um resultado para uma pergunta que
// não foi feita direito. Filtro AUSENTE continua sendo "sem filtro"; o 400 é
// só para o que foi enviado e não serve.
// ═══════════════════════════════════════════════════════════════════════════

const erroDeFiltro = (campo, mensagem) => {
  const error = new Error(mensagem);
  error.statusCode = 400;
  error.campo = campo;
  return error;
};

// Devolve a string quando o valor é string não-vazia; senão `undefined`.
//
// Texto NÃO vira 400: `?busca=` vazio, ou um valor torto num campo de busca, é
// conveniência de listagem, e derrubar a tela porque o termo veio estranho
// seria pior que ignorá-lo. A assimetria com o id é proposital — um id
// malformado significa que a tela montou uma URL errada; um texto estranho
// significa que alguém digitou algo estranho.
export const filtroTexto = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : undefined;
};

// ── Fase 3.4 (DEC-115): o tipo de ação da lista de processos ──────────────
// Diferente de `filtroTexto`, este RECUSA valor que não é texto: o tipo vem de
// uma pílula com opções da própria advogada (`GET /processes/tipos-acao`), e
// um array ou objeto na query é URL montada errada — não alguém digitando.
// Vazio é ignorado (a pílula "Todos os tipos"). O teto é o do campo na tela.
export const LIMITE_TIPO_ACAO = 200;
export const filtroTipoAcao = (valor, campo = "tipoAcao") => {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser um texto.`);
  }
  const limpo = valor.trim();
  if (limpo === "") return undefined;
  if (limpo.length > LIMITE_TIPO_ACAO) {
    throw erroDeFiltro(campo, `O filtro "${campo}" passa de ${LIMITE_TIPO_ACAO} caracteres.`);
  }
  return limpo;
};

// ── Fase 3.4 (DEC-115): a liberação no portal ─────────────────────────────
// `nao_liberado` | `liberado`; vazio e ausente não filtram. Outro valor é 400:
// ignorá-lo devolveria a lista inteira com cara de recortada, e a advogada
// leria "todos liberados" onde não há recorte nenhum.
export const PORTAIS = Object.freeze(["nao_liberado", "liberado"]);
export const filtroPortal = (valor, campo = "portal") => {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser "nao_liberado" ou "liberado".`);
  }
  const limpo = valor.trim();
  if (limpo === "") return undefined;
  if (!PORTAIS.includes(limpo)) {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser "nao_liberado" ou "liberado".`);
  }
  return limpo;
};

// ── Fase 3.5 (DEC-119): o portal na lista de CLIENTES ─────────────────────
// Outro vocabulário que o de processos, porque a pergunta é outra: lá é "este
// processo está liberado?"; aqui é "esta pessoa tem acesso, e algum processo
// dela ficou de fora?". `com_acesso` / `sem_acesso` olham a senha;
// `nao_liberado` usa a regra da DEC-108/115 (`liberacaoNoPortal.js`).
// Vazio e ausente não filtram; outro valor é 400, pelo motivo de `PORTAIS`.
export const PORTAIS_DO_CLIENTE = Object.freeze(["com_acesso", "sem_acesso", "nao_liberado"]);
export const filtroPortalDoCliente = (valor, campo = "portal") => {
  if (valor === undefined || valor === null) return undefined;
  const mensagem = `O filtro "${campo}" precisa ser um de: ${PORTAIS_DO_CLIENTE.join(", ")}.`;
  if (typeof valor !== "string") throw erroDeFiltro(campo, mensagem);
  const limpo = valor.trim();
  if (limpo === "") return undefined;
  if (!PORTAIS_DO_CLIENTE.includes(limpo)) throw erroDeFiltro(campo, mensagem);
  return limpo;
};

// ── Fase 3.5 (DEC-119): pessoa física ou jurídica ─────────────────────────
// A query fala a sigla da tela (`PF` / `PJ`); o banco guarda `fisica` /
// `juridica`. Devolve o valor do banco. Vazio não filtra; outro valor é 400.
export const TIPOS_PESSOA_NA_QUERY = Object.freeze({ PF: "fisica", PJ: "juridica" });
export const filtroTipoPessoa = (valor, campo = "tipoPessoa") => {
  if (valor === undefined || valor === null) return undefined;
  const mensagem = `O filtro "${campo}" precisa ser "PF" ou "PJ".`;
  if (typeof valor !== "string") throw erroDeFiltro(campo, mensagem);
  const limpo = valor.trim();
  if (limpo === "") return undefined;
  const tipo = TIPOS_PESSOA_NA_QUERY[limpo];
  if (!tipo) throw erroDeFiltro(campo, mensagem);
  return tipo;
};

// ── DEC-052: listar o que foi desativado ──────────────────────────────────
//
// Até a F-2b as listagens de cliente e processo filtravam `ativo: true` sem
// alternativa. Isso tornava a reativação **impossível pela interface**: um
// registro desativado não aparecia em lugar nenhum, e um menu ⋮ com "Reativar"
// não tinha linha onde existir.
//
// Três valores, e o padrão é o comportamento de sempre:
//
//   ausente / "ativos"  → `{ ativo: true }`   (o padrão, inalterado)
//   "inativos"          → `{ ativo: false }`
//   "todos"             → `{}`                (sem restrição)
//
// Valor desconhecido vira **400 com `campo`**, como o id malformado da F-0 e
// pelo mesmo motivo: `?situacao=ativas` (feminino, plural errado) devolveria
// silenciosamente a lista de ativos e a advogada concluiria que não há
// desativados. Filtro que erra calado é pior que filtro que recusa.
export const SITUACOES = Object.freeze(["ativos", "inativos", "todos"]);

export const filtroSituacao = (valor, campo = "situacao") => {
  if (valor === undefined || valor === null || valor === "") return { ativo: true };

  if (typeof valor !== "string" || !SITUACOES.includes(valor)) {
    throw erroDeFiltro(
      campo,
      `Situação inválida. Use um de: ${SITUACOES.join(", ")}.`
    );
  }

  if (valor === "todos") return {};
  return { ativo: valor === "ativos" };
};

// ── DEC-062: a ordenação da listagem de clientes ──────────────────────────
//
// Vocabulário FECHADO, pelo mesmo motivo de `SITUACOES` e de `DEPENDENCIA`:
// sem lista, em duas fases existiriam `nome_asc`, `nomeAsc` e `asc` como
// valores possíveis, e a tela voltaria a chutar.
//
// **O padrão é `nome_asc`, e isso é mudança de comportamento deliberada.**
// Até a A-1 a listagem saía por `createdAt: -1` — ordem de cadastro, que não
// significa nada para quem procura um nome. Quem não mexer no seletor passa a
// ver a lista em ordem alfabética, que é o que foi pedido.
export const ORDENACOES_CLIENTE = Object.freeze(["nome_asc", "nome_desc"]);

export const ordenacaoDeClientes = (valor, campo = "ordem") => {
  if (valor === undefined || valor === null || valor === "") return "nome_asc";

  if (typeof valor !== "string" || !ORDENACOES_CLIENTE.includes(valor)) {
    // 400 com `campo`, e não descarte silencioso: um `?ordem=alfabetica`
    // ignorado devolveria a lista em OUTRA ordem sem nada dizendo isso, e a
    // advogada concluiria que a ordenação não funciona. É a mesma escolha que
    // `filtroSituacao` já faz — e pela mesma razão pela qual texto de busca,
    // ao contrário, é descartado: aqui quem montou a URL foi a tela.
    throw erroDeFiltro(
      campo,
      `Ordenação inválida. Use uma de: ${ORDENACOES_CLIENTE.join(", ")}.`
    );
  }

  return valor;
};

// Devolve o id quando é string e ObjectId válido; senão `undefined`.
//
// A checagem de `typeof` vem ANTES de `isValid`: `isValid` aceita coisas que
// não são string (um Buffer de 12 bytes, por exemplo), e é justamente um valor
// não-string que a injeção de operador entregaria.
export const filtroObjectId = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  if (!mongoose.Types.ObjectId.isValid(limpo)) return undefined;
  return limpo;
};

// A versão que RECUSA em vez de descartar (Fase F-0). Ausente ⇒ `undefined`
// (sem filtro). Presente e inválido ⇒ lança 400 com `campo`.
//
// `campo` é o nome do parâmetro na query string, e não um nome interno: é o
// que a tela precisa para saber qual input ou qual link montou a URL errada.
export const filtroObjectIdExigido = (valor, campo) => {
  if (valor === undefined || valor === null) return undefined;

  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser um id válido.`);
  }

  const limpo = valor.trim();
  if (limpo === "") return undefined;

  if (!mongoose.Types.ObjectId.isValid(limpo)) {
    throw erroDeFiltro(campo, `O filtro "${campo}" não é um id válido.`);
  }

  return limpo;
};

// ═══════════════════════════════════════════════════════════════════════════
// O PAR DE PERÍODO `de` / `ate` (Fase F-1b.3)
//
// ── Por que o recorte é em UTC, e não no fuso local do servidor ───────────
// O enunciado desta fase pediu "interpretação em fuso local, o mesmo
// tratamento que o resumo do dashboard já usa para `mesReferencia`". Medido
// no código, o resumo faz o CONTRÁRIO do que o enunciado supõe: ele recorta o
// mês em UTC (`Date.UTC(ano, mes, 1)`), e o comentário de lá diz por quê —
// `dataVencimento` e `dataPagamento` são datas SEM hora, chegam como
// `"2026-08-31"`, o Mongoose as grava em meia-noite UTC e o frontend as
// renderiza com `timeZone: "UTC"`.
//
// Recortar em fuso local devolveria, num servidor a oeste de Greenwich, uma
// parcela de 01/09 dentro de um filtro `ate=2026-08-31` — porque 01/09T00:00Z
// é 31/08 às 21h em Brasília. A data é gravada, exibida e agora filtrada no
// mesmo fuso; é essa coerência, e não o fuso em si, que faz o filtro devolver
// o que a linha da tabela mostra.
//
// Então: **adotado UTC**, que é o que o dashboard de fato faz. A divergência
// está declarada no relatório da fase.
//
// ── As bordas são INCLUSIVAS ─────────────────────────────────────────────
// `de` vira 00:00:00.000Z do dia; `ate` vira 23:59:59.999Z do MESMO dia. Um
// `ate` em meia-noite excluiria o dia inteiro que a pessoa acabou de digitar —
// e "de 01/06 a 10/06" que não mostra o pagamento de 10/06 é o tipo de recorte
// que faz alguém concluir que o lançamento sumiu.
//
// Um sem o outro é período aberto de um lado: só `de` é "daqui em diante", só
// `ate` é "até aqui".
// ═══════════════════════════════════════════════════════════════════════════

const AAAA_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Converte `"2026-06-10"` no instante UTC pedido. Ausente ⇒ `undefined` (sem
// borda). Presente e inválido ⇒ 400 com `campo`, no mesmo padrão do id: data
// torta significa que a tela montou uma URL errada, e adivinhar um dia
// devolveria um recorte que ninguém pediu.
//
// A checagem de `typeof` vem antes de tudo pelo mesmo motivo de
// `filtroObjectId`: um valor não-string é o que a injeção de operador
// entregaria, e `new Date({...})` não recusa nada de forma útil.
export const filtroDataExigida = (valor, campo, { fimDoDia = false } = {}) => {
  if (valor === undefined || valor === null) return undefined;

  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser uma data no formato AAAA-MM-DD.`);
  }

  const limpo = valor.trim();
  if (limpo === "") return undefined;

  const partes = AAAA_MM_DD.exec(limpo);
  if (!partes) {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser uma data no formato AAAA-MM-DD.`);
  }

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  // `Date.UTC` normaliza silenciosamente: 2026-02-31 vira 03/03. A volta pelo
  // `getUTC*` é o que recusa a data que não existe em vez de deslizá-la —
  // filtrar por um dia que o calendário não tem e receber outro é pior que 400.
  const instante = new Date(
    Date.UTC(ano, mes - 1, dia, fimDoDia ? 23 : 0, fimDoDia ? 59 : 0, fimDoDia ? 59 : 0, fimDoDia ? 999 : 0)
  );

  const real =
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia;

  if (!real) {
    throw erroDeFiltro(campo, `O filtro "${campo}" não é uma data existente.`);
  }

  return instante;
};

// O par completo, já no formato que o Mongo espera (`{ $gte, $lte }`), ou
// `undefined` quando nenhuma das duas bordas veio — filtro ausente não filtra.
//
// `de` posterior a `ate` é 400 e não lista vazia: uma lista vazia para um
// período impossível é indistinguível de "não há lançamentos nesse período", e
// a pessoa procuraria o lançamento em vez de olhar as duas datas que digitou.
export const filtroPeriodo = (de, ate, { campoDe = "de", campoAte = "ate" } = {}) => {
  const inicio = filtroDataExigida(de, campoDe);
  const fim = filtroDataExigida(ate, campoAte, { fimDoDia: true });

  if (!inicio && !fim) return undefined;

  if (inicio && fim && inicio > fim) {
    throw erroDeFiltro(
      campoDe,
      `O início do período ("${campoDe}") é posterior ao fim ("${campoAte}"). ` +
      "Inverta as duas datas."
    );
  }

  const intervalo = {};
  if (inicio) intervalo.$gte = inicio;
  if (fim) intervalo.$lte = fim;
  return intervalo;
};

// ═══════════════════════════════════════════════════════════════════════════
// O MÊS DE REFERÊNCIA — `?mes=AAAA-MM` (Fase 3.1, DEC-098)
//
// O Início escolhe o mês dos blocos financeiros e dos gráficos. Ausente ⇒
// `undefined`, e quem chama usa o mês corrente do servidor (o comportamento de
// sempre). Presente e inválido ⇒ 400 com `campo`, no padrão de
// `filtroDataExigida`: mês torto é URL montada errada, e adivinhar um mês
// devolveria números de outro período com cara de certos.
//
// O ano vai de 2000 a 2100. Não é regra de negócio: é o teto do que faz
// sentido num escritório de hoje, e o que impede `?mes=9999-01` de virar uma
// consulta a um intervalo absurdo.
//
// Devolve `{ ano, mes }` com `mes` de 0 a 11, pronto para `Date.UTC`.
// ═══════════════════════════════════════════════════════════════════════════
const AAAA_MM = /^(\d{4})-(\d{2})$/;
export const ANO_MINIMO = 2000;
export const ANO_MAXIMO = 2100;

export const filtroMesReferencia = (valor, campo = "mes") => {
  if (valor === undefined || valor === null) return undefined;

  const mensagem = `O filtro "${campo}" precisa ser um mês no formato AAAA-MM, de ${ANO_MINIMO} a ${ANO_MAXIMO}.`;

  if (typeof valor !== "string") throw erroDeFiltro(campo, mensagem);

  const limpo = valor.trim();
  if (limpo === "") return undefined;

  const partes = AAAA_MM.exec(limpo);
  if (!partes) throw erroDeFiltro(campo, mensagem);

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  if (mes < 1 || mes > 12 || ano < ANO_MINIMO || ano > ANO_MAXIMO) {
    throw erroDeFiltro(campo, mensagem);
  }

  return { ano, mes: mes - 1 };
};

export default {
  filtroMesReferencia,
  filtroTexto,
  filtroSituacao,
  ordenacaoDeClientes,
  filtroObjectId,
  filtroObjectIdExigido,
  filtroDataExigida,
  filtroPeriodo,
  filtroTipoAcao,
  filtroPortal,
  filtroPortalDoCliente,
  filtroTipoPessoa
};
