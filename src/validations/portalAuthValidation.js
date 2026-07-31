// Validação de payload do portal, no padrão do projeto: função pura que
// devolve string de erro ou `null`.
//
// Deliberadamente FRACA no login: só confere que os dois campos vieram como
// string não vazia. Qualquer validação a mais — formato do código, tamanho da
// senha — responderia 400 antes do 401 unificado e viraria oráculo: "400" para
// código malformado e "401" para código bem formado já separa o espaço de
// busca. O formato do código é conferido dentro do service, no mesmo caminho
// que produz o 401 único.

const naoVazio = (valor) => typeof valor === "string" && valor.trim().length > 0;

export const validateLoginPortal = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }
  if (!naoVazio(data.codigoAcesso)) {
    return "Código de acesso é obrigatório";
  }
  if (typeof data.senha !== "string" || data.senha.length === 0) {
    return "Senha é obrigatória";
  }
  return null;
};

export const validateTrocaSenhaPortal = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }
  if (typeof data.senhaAtual !== "string" || data.senhaAtual.length === 0) {
    return "Senha atual é obrigatória";
  }
  if (typeof data.novaSenha !== "string" || data.novaSenha.length === 0) {
    return "Nova senha é obrigatória";
  }
  return null;
};

export default { validateLoginPortal, validateTrocaSenhaPortal };
