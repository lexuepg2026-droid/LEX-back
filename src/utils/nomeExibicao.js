// ═══════════════════════════════════════════════════════════════════════════
// O NOME PELO QUAL UM CLIENTE APARECE — ponto único (DEC-062)
//
// Cliente PF e cliente PJ **não guardam o nome no mesmo campo**: PF tem
// `nomeCompleto`, PJ tem `razaoSocial` (e `nomeFantasia` como terceira opção).
// Ordenar a listagem por um só deles deixaria metade dos clientes sem chave de
// ordenação — e, na prática, todos os PJ no fim da lista, juntos, na ordem de
// cadastro.
//
// Esta função é a resposta a "por qual nome este cliente aparece", e ela é
// usada por DOIS caminhos que precisavam concordar e não concordavam por
// construção:
//
//   • o hook do `Client`, que grava `nomeExibicao` (a chave de ordenação);
//   • `nomeDoCliente`, em `services/activationHierarchy.js`, que nomeia o pai
//     inativo nas mensagens da DEC-053.
//
// Antes da A-1 a precedência estava escrita à mão nos dois lugares. Duas
// listas de prioridade para a mesma pergunta divergem na primeira vez que
// alguém acrescentar um campo — e aqui divergir significa a mensagem de erro
// chamar o cliente de um jeito e a listagem ordená-lo por outro.
//
// ── Por que vazio, e não "(sem nome)" ──────────────────────────────────────
// Esta função devolve **string vazia** quando não há nome nenhum. O
// "(sem nome)" é decisão de EXIBIÇÃO e mora em `nomeDoCliente`, que é quem
// monta frase para humano. Gravar "(sem nome)" como chave de ordenação
// colocaria esses clientes no meio da letra P, como se fosse um nome.
// ═══════════════════════════════════════════════════════════════════════════

const primeiroPreenchido = (...valores) => {
  for (const valor of valores) {
    if (typeof valor === "string" && valor.trim().length > 0) {
      return valor.trim();
    }
  }
  return "";
};

// A precedência é a do cadastro, e não alfabética: `nomeCompleto` é o campo de
// PF, `razaoSocial` é o nome legal do PJ, e `nomeFantasia` só entra quando a
// razão social não foi informada — é o que a advogada digitou por último e o
// único nome que resta para achar a empresa.
export const nomeExibicaoDoCliente = (cliente) =>
  primeiroPreenchido(cliente?.nomeCompleto, cliente?.razaoSocial, cliente?.nomeFantasia);

export default nomeExibicaoDoCliente;
