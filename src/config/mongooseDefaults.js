import mongoose from "mongoose";

// Configuração de schema que vale para TODO model. Importado como primeiro
// import de `app.js` e dos scripts, antes de qualquer model ser compilado.
//
// `__v` é o controle de concorrência otimista do Mongoose e não interessa a
// nenhum cliente da API. Sai da SAÍDA JSON, e não do documento gravado:
// `versionKey: false` no schema desligaria o versionamento no banco, que é
// coisa diferente e não é o que se quer.
//
// Global de propósito. Regra que vale para todo model não se repete em cada
// schema — o próximo model criado esqueceria dela, e o `__v` voltaria a
// aparecer em um módulo só.
//
// ATENÇÃO: consulta com `.lean()` devolve objeto plano e NÃO passa por
// `toJSON`. Onde houver `lean()`, o `__v` tem de sair pela projeção da própria
// consulta — hoje são as duas de `processService` (listProcesses e
// getProcessById), ambas com `.select("-__v")`.
// ── Segredos que nunca saem na resposta ────────────────────────────────────
// `select: false` no schema protege a LEITURA, mas não o documento que acabou
// de ser escrito: quem faz `new Client(...)`, atribui o hash e chama `save()`
// tem o campo em memória, e ele sai no JSON da resposta de criação. Foi
// exatamente assim que `senhaPortalHash` vazou na primeira execução da Fase
// 3.1 — a listagem estava limpa e o 201 do cadastro, não.
//
// Aqui é o ponto único que cobre os dois caminhos, para todo model. Regra que
// vale para todo model não se repete em cada schema: o próximo model com
// segredo esqueceria dela.
const SEGREDOS = ["senhaHash", "senhaPortalHash"];

mongoose.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.__v;
    for (const campo of SEGREDOS) delete ret[campo];
    return ret;
  }
});
