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
mongoose.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  }
});
