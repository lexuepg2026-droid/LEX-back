// ═══════════════════════════════════════════════════════════════════════════
// DATA DE CALENDÁRIO — o risco número um da F-3, fechado num ponto só
//
// ── O defeito que esta fase tinha de não repetir ──────────────────────────
// Este projeto já teve defeito de fuso: o recibo do portal (passo 91). O
// mesmo defeito, num calendário, é pior — porque ele não parece um defeito.
//
// Um evento gravado como INSTANTE UTC e lido no navegador MUDA DE DIA:
// `2026-09-01T00:00:00.000Z` renderizado em Brasília (UTC−3) é
// 31/08 às 21h. A audiência de segunda aparece no domingo, e quem olhar a
// grade não desconfia do calendário — desconfia da própria memória.
//
// ── A causa, dita em uma frase ───────────────────────────────────────────
// **Data sem hora não é um instante. É uma data de calendário.**
//
// "01/09/2026" não nomeia um ponto na linha do tempo: nomeia uma CASA no
// calendário. Um instante nomeia um ponto, e todo ponto precisa de um fuso
// para virar dia. Tratar a casa como ponto obriga o sistema a inventar um
// fuso — e é o fuso inventado que produz o deslocamento.
//
// ── As três decisões que decorrem disso ──────────────────────────────────
//
// 1. **ENTRADA ESTRITA.** Só `AAAA-MM-DD` é aceito. Um instante ISO
//    (`2026-09-01T03:00:00.000Z`) é RECUSADO, e não normalizado em silêncio:
//    ele carrega um fuso que a data de calendário não tem, e "adivinhar" qual
//    dia ele quis dizer é exatamente a adivinhação que produz o defeito. Quem
//    manda um instante acredita estar mandando um instante, e precisa saber
//    que não é isso que este campo guarda.
//
// 2. **ARMAZENAMENTO EM MEIA-NOITE UTC.** É o que `dataVencimento` e
//    `dataPagamento` já fazem desde a Fase 4 (o Mongoose grava `"2026-08-31"`
//    assim), e o que `dashboardService` e `filtrosDeConsulta` já pressupõem ao
//    recortar mês e período com `Date.UTC`. Escolher outra coisa aqui faria o
//    calendário e o financeiro discordarem sobre em que dia cai a mesma
//    parcela.
//
// 3. **SAÍDA COMO STRING `AAAA-MM-DD`, e não como instante ISO.** Esta é a
//    mudança de verdade da fase, e é a que fecha o buraco em vez de remendá-lo.
//
//    O projeto até aqui devolvia o instante e consertava na exibição, com
//    `timeZone: "UTC"` em `formatters.js`. Isso FUNCIONA — e funciona só
//    enquanto ninguém esquecer. É remédio aplicado em cada ponto de chamada:
//    um `new Date(iso).getDate()` esquecido numa grade de calendário, que
//    compara datas dezenas de vezes por render, devolve o dia errado sem erro
//    nenhum e sem teste vermelho.
//
//    Uma string que diz exatamente o que significa não pode ser mal lida. Não
//    há fuso para aplicar, não há fuso para esquecer de aplicar.
//
// ── "Hoje" é em UTC, e a janela de 3 horas é DÍVIDA ACEITA ───────────────
// `hojeComoDataDeCalendario()` lê o dia em UTC, como `dashboardService` já faz
// (`agora.getUTCDate()`, na conta de "vencidas" e "próximos vencimentos").
//
// A consequência é conhecida e está registrada: das 21h às 24h de Brasília, o
// "hoje" do sistema já é o dia seguinte. Adotar o fuso do escritório SÓ AQUI
// consertaria o sino e faria a contagem de parcelas vencidas do sino discordar
// da do painel por três horas todo dia — dois números para a mesma pergunta, e
// é justamente essa a classe de defeito que a DEC-048 e a DEC-055 existem para
// impedir.
//
// **Quando o projeto adotar um fuso de escritório, ele muda AQUI**, e as duas
// telas mudam juntas. É para isso que a função é uma só.
// ═══════════════════════════════════════════════════════════════════════════

export const AAAA_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Leitura ───────────────────────────────────────────────────────────────
//
// `"2026-09-01"` → `Date` em `2026-09-01T00:00:00.000Z`. Qualquer outra coisa
// devolve `null` — inclusive um instante ISO completo, e inclusive um dia que
// o calendário não tem.
//
// Quem quiser 400 com mensagem chama `exigirDataDeCalendario`; devolver `null`
// aqui é o que deixa a função servir também aos pontos que só querem saber se
// o valor serve (a validação à mão, que acumula erros em vez de lançar no
// primeiro).
export const lerDataDeCalendario = (valor) => {
  if (typeof valor !== "string") return null;

  const partes = AAAA_MM_DD.exec(valor.trim());
  if (!partes) return null;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  const instante = new Date(Date.UTC(ano, mes - 1, dia));

  // `Date.UTC` desliza em silêncio: 2026-02-31 vira 03/03. A volta pelos
  // `getUTC*` recusa o dia que não existe em vez de trocá-lo por outro —
  // gravar 03/03 para quem digitou 31/02 é pior do que recusar, porque a
  // advogada leria uma data que ela não escreveu e não teria como saber disso.
  // É a mesma checagem de `filtroDataExigida`, e pela mesma razão.
  const real =
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia;

  return real ? instante : null;
};

// ── Escrita ───────────────────────────────────────────────────────────────
//
// `Date` → `"2026-09-01"`, lido pelos componentes UTC. NUNCA por
// `toISOString().slice(0, 10)` disfarçado de atalho: são equivalentes hoje
// porque o instante está em meia-noite UTC, e deixariam de ser no dia em que
// um valor entrasse por outra porta com hora diferente de zero. Ler o
// componente é o que descreve a intenção.
//
// Também aceita a string já pronta, e a devolve normalizada: os serviços
// recebem ora o documento do Mongo (com `Date`), ora o payload (com string), e
// forçar cada chamador a saber qual dos dois tem em mãos é como o mesmo campo
// acaba serializado de dois jeitos na mesma resposta.
export const escreverDataDeCalendario = (valor) => {
  if (valor === null || valor === undefined) return null;

  if (typeof valor === "string") {
    const lida = lerDataDeCalendario(valor);
    return lida ? valor.trim() : null;
  }

  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;

  const ano = String(data.getUTCFullYear()).padStart(4, "0");
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
};

// ── "Hoje" ────────────────────────────────────────────────────────────────
//
// Devolve a STRING, não o `Date`: quem compara datas de calendário compara
// strings `AAAA-MM-DD`, cuja ordem lexicográfica é a ordem cronológica. É a
// comparação que não tem fuso para errar.
export const hojeComoDataDeCalendario = (agora = new Date()) =>
  escreverDataDeCalendario(agora);

// O mesmo "hoje", em `Date` de meia-noite UTC, para entrar em filtro do Mongo
// (`{ $lt: inicioDeHoje }`). Sai da mesma fonte que a string acima, de
// propósito: duas leituras independentes do relógio poderiam cair em dias
// diferentes na virada da meia-noite.
export const inicioDoDiaUTC = (dataDeCalendario) => lerDataDeCalendario(dataDeCalendario);

// Fim do dia, inclusivo — `23:59:59.999Z`. As bordas de intervalo deste
// projeto são inclusivas desde a F-1b.3 (`filtroPeriodo`), e um `$lte` em
// meia-noite excluiria o dia inteiro que a pessoa acabou de pedir.
export const fimDoDiaUTC = (dataDeCalendario) => {
  const inicio = lerDataDeCalendario(dataDeCalendario);
  if (!inicio) return null;
  return new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1);
};

// ── A HORA, e por que ela NÃO entra no `Date` ────────────────────────────
//
// `"14:30"`, ou `null`. String, e nunca parte do instante gravado.
//
// Pôr a hora dentro do `Date` devolveria o campo à condição de instante — que
// é o defeito inteiro desta fase, reintroduzido pela porta dos fundos e só nos
// eventos que têm horário. A audiência das 14h30 de 01/09 voltaria a poder ser
// lida como 31/08 em algum fuso, e a de 01/09 sem hora não; o mesmo campo
// mentiria em metade das linhas.
//
// A hora é HORA DE PAREDE do escritório: "a audiência é às 14h30" não muda de
// número porque alguém abriu o sistema em outro fuso. Guardá-la como texto é o
// que faz o número gravado ser o número lido, sem conversão nenhuma no meio.
export const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const horaValida = (valor) =>
  typeof valor === "string" && HH_MM.test(valor.trim());

export default {
  AAAA_MM_DD,
  HH_MM,
  lerDataDeCalendario,
  escreverDataDeCalendario,
  hojeComoDataDeCalendario,
  inicioDoDiaUTC,
  fimDoDiaUTC,
  horaValida
};
