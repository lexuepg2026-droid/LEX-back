// ═══════════════════════════════════════════════════════════════════════════
// O VOLUME DO SEED (`seed:demo:volume`) — as PEÇAS PURAS, sem banco
//
// O seed grava pelos serviços, e quem prova que os serviços aceitam o que ele
// manda é a própria execução (ela termina com código 1 se qualquer chamada for
// recusada). O que se prova AQUI é o que não depende de banco e que, se
// estivesse errado, produziria dado inválido em silêncio:
//
//   • documento fictício com dígito verificador válido (o sistema o recusa se
//     não fechar) e número de processo que passa na conferência do CNJ;
//   • a mesma base para a mesma semente (dev e produção recebem o MESMO volume);
//   • a soma das parcelas fechando EXATAMENTE (a regra do reparcelamento);
//   • nenhum prenome do projeto nas listas de nomes;
//   • CEP coerente com a cidade;
//   • o tamanho que a paginação precisa.
// ═══════════════════════════════════════════════════════════════════════════

import "../helpers/env.js";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { criarSorteio } from "../../scripts/lib/volume/sorteio.js";
import {
  gerarCPF, gerarCNPJ, montarNumeroCNJ, numeroCNJValido, calcularDigitoCNJ
} from "../../scripts/lib/volume/documentosBR.js";
import * as BR from "../../scripts/lib/volume/dadosBR.js";
import { carregarTabelas, localizarPastaDeTabelas } from "../../scripts/lib/volume/tabelas.js";
import { somarDias, somarMeses, dividirEmParcelas, TAMANHO } from "../../scripts/lib/volume/gerarVolume.js";
import { validarCPF, validarCNPJ } from "../../src/utils/documentos.js";

const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

describe("sorteio determinístico", () => {
  test("mesma semente, mesma sequência — e semente diferente, sequência diferente", () => {
    const a = criarSorteio(42);
    const b = criarSorteio(42);
    const c = criarSorteio(43);
    const sequencia = (s) => Array.from({ length: 20 }, () => s.inteiro(0, 1000));

    assert.deepEqual(sequencia(a), sequencia(b));
    assert.notDeepEqual(sequencia(criarSorteio(42)), sequencia(c));
  });

  test("inteiro respeita os limites, inclusive os dois extremos", () => {
    const s = criarSorteio(7);
    const vistos = new Set();
    for (let i = 0; i < 2000; i += 1) {
      const n = s.inteiro(3, 6);
      assert.ok(n >= 3 && n <= 6);
      vistos.add(n);
    }
    assert.deepEqual([...vistos].sort(), [3, 4, 5, 6]);
  });

  test("ponderado respeita a proporção aproximada e escolher recusa lista vazia", () => {
    const s = criarSorteio(11);
    let a = 0;
    for (let i = 0; i < 5000; i += 1) if (s.ponderado([["a", 80], ["b", 20]]) === "a") a += 1;
    assert.ok(a > 3800 && a < 4200, `a=${a} de 5000 (esperado ~4000)`);
    assert.throws(() => s.escolher([]), /lista vazia/);
  });

  test("embaralhar não altera a lista original e preserva os elementos", () => {
    const original = [1, 2, 3, 4, 5, 6];
    const embaralhada = criarSorteio(5).embaralhar(original);
    assert.deepEqual(original, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...embaralhada].sort(), original);
  });
});

describe("documentos fictícios com dígito verificador válido", () => {
  test("2000 CPFs e 2000 CNPJs, todos válidos pelo validador DO SISTEMA", () => {
    const s = criarSorteio(1);
    for (let i = 0; i < 2000; i += 1) {
      const cpf = gerarCPF(s);
      const cnpj = gerarCNPJ(s);
      assert.match(cpf, /^\d{11}$/);
      assert.match(cnpj, /^\d{14}$/);
      assert.ok(validarCPF(cpf), `CPF inválido: ${cpf}`);
      assert.ok(validarCNPJ(cnpj), `CNPJ inválido: ${cnpj}`);
      assert.ok(cnpj.slice(8, 12) === "0001", "matriz (filial 0001)");
      assert.ok(!/^(\d)\1{10}$/.test(cpf), `CPF de dígitos iguais: ${cpf}`);
    }
  });

  test("o número do processo passa na conferência do CNJ (módulo 97)", () => {
    for (const [sequencial, ano, foro] of [[1234, 2025, 19], [1, 2020, 1], [9999999, 2026, 4321], [500, 2023, 0]]) {
      const numero = montarNumeroCNJ({ sequencial, ano, foro });
      assert.match(numero, /^\d{7}-\d{2}\.\d{4}\.8\.16\.\d{4}$/, "formato NNNNNNN-DD.AAAA.8.16.OOOO");
      assert.equal(numero.replace(/\D/g, "").length, 20, "20 dígitos");
      assert.ok(numeroCNJValido(numero), numero);
    }
  });

  test("a conferência do CNJ recusa um dígito alterado, e o DV tem sempre 2 dígitos", () => {
    const numero = montarNumeroCNJ({ sequencial: 1234, ano: 2025, foro: 19 });
    const adulterado = numero.replace(/-(\d{2})\./, (_, dd) => `-${dd === "00" ? "01" : "00"}.`);
    assert.ok(!numeroCNJValido(adulterado));
    assert.ok(!numeroCNJValido("0001234-10.2025.8.16.0001".replace("10", "99")));
    for (let n = 1; n < 400; n += 7) assert.equal(calcularDigitoCNJ({ sequencial: n, ano: 2024, foro: 19 }).length, 2);
  });
});

describe("parcelas e datas de calendário", () => {
  test("dividirEmParcelas soma EXATAMENTE o total, e a sobra vai para a PRIMEIRA (DEC-049)", () => {
    const s = criarSorteio(3);
    for (let i = 0; i < 500; i += 1) {
      const total = s.inteiro(100, 5_000_000);
      const n = s.inteiro(1, 12);
      const partes = dividirEmParcelas(total, n);
      assert.equal(partes.length, n);
      assert.equal(partes.reduce((a, b) => a + b, 0), total, `${total} em ${n}`);
      assert.ok(partes.every((p) => Number.isInteger(p) && p > 0));
      assert.ok(partes[0] >= Math.max(...partes.slice(1), 0), "a primeira leva a sobra");
    }
    assert.deepEqual(dividirEmParcelas(100000, 3), [33334, 33333, 33333], "o exemplo do R$ 1.000,00 em 3");
  });

  test("somarMeses não transborda: 31/01 + 1 mês é o último dia de fevereiro, e não 03/03", () => {
    assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
    assert.equal(somarMeses("2028-01-31", 1), "2028-02-29", "ano bissexto");
    assert.equal(somarMeses("2026-03-31", 1), "2026-04-30");
    assert.equal(somarMeses("2026-11-15", 3), "2027-02-15", "vira o ano");
    assert.equal(somarMeses("2026-05-10", 0), "2026-05-10");
  });

  test("somarDias anda em dias de calendário, nos dois sentidos, sem deslocar por fuso", () => {
    assert.equal(somarDias("2026-09-19", 1), "2026-09-20");
    assert.equal(somarDias("2026-09-19", -19), "2026-08-31");
    assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
  });
});

describe("dados brasileiros fictícios", () => {
  const todasAsListas = {
    femininos: BR.PRENOMES_FEMININOS, masculinos: BR.PRENOMES_MASCULINOS, sobrenomes: BR.SOBRENOMES
  };

  test("NENHUM nome do projeto aparece nas listas (a advogada, o orientador, os colegas)", () => {
    for (const [nome, lista] of Object.entries(todasAsListas)) {
      for (const item of lista) {
        assert.ok(!BR.PRENOMES_PROIBIDOS.includes(semAcento(item)), `"${item}" (${nome}) é um nome do projeto`);
      }
    }
  });

  test("as listas não têm repetição (repetir peso o sorteio sem ninguém decidir)", () => {
    for (const [nome, lista] of Object.entries(todasAsListas)) {
      assert.equal(new Set(lista.map(semAcento)).size, lista.length, `repetição em ${nome}`);
    }
  });

  test("CEP coerente com a cidade: prefixo da cidade, formato 00000-000, estado PR", () => {
    const s = criarSorteio(9);
    const cidades = new Set();
    for (let i = 0; i < 1500; i += 1) {
      const e = BR.montarEndereco(s);
      assert.match(e.cep, /^\d{5}-\d{3}$/);
      assert.equal(e.estado, "PR");
      assert.equal(e.pais, "Brasil");
      const prefixos = BR.PREFIXOS_POR_CIDADE[e.cidade];
      assert.ok(prefixos, `cidade sem prefixo conhecido: ${e.cidade}`);
      assert.ok(prefixos.includes(e.cep.slice(0, 5)), `${e.cidade} com CEP ${e.cep}`);
      cidades.add(e.cidade);
    }
    assert.ok(cidades.has("Ponta Grossa") && cidades.size >= 8, "Ponta Grossa domina, mas a região aparece");
  });

  test("Ponta Grossa começa em 840 (o CEP de quem mora lá)", () => {
    for (const prefixo of BR.PREFIXOS_POR_CIDADE["Ponta Grossa"]) assert.ok(prefixo.startsWith("840"), prefixo);
  });

  test("e-mails de teste usam domínios reservados (.test), nunca um domínio real", () => {
    const s = criarSorteio(2);
    for (let i = 0; i < 200; i += 1) {
      const email = BR.montarEmail("Fulana de Tal Souza", i, s);
      assert.match(email, /^[a-z0-9.]+@[a-z]+\.test$/, email);
    }
  });

  test("o catálogo de ações cobre Família, Cível e Consumidor, e todo caso tem faixa de honorário válida", () => {
    const areas = new Set(BR.CASOS.map((c) => c.area));
    assert.deepEqual([...areas].sort(), ["DIREITO CIVIL", "DIREITO DO CONSUMIDOR"]);
    assert.ok(BR.CASOS.some((c) => c.herdeiros), "há caso de litisconsórcio (herdeiros)");
    assert.ok(BR.CASOS.some((c) => c.reu), "há caso em que o cliente é o réu");
    for (const c of BR.CASOS) {
      assert.ok(c.classe && c.titulo && c.desc && c.vara, c.chave);
      assert.ok(c.faixa[0] > 0 && c.faixa[1] > c.faixa[0], `${c.chave}: faixa`);
      assert.ok(c.pf || c.pj, `${c.chave}: sem tipo de cliente`);
    }
  });
});

describe("o volume tem o tamanho que a paginação precisa", () => {
  test("mais de 5 páginas de clientes com 20 por página, contando os 8 do seed curado", () => {
    const total = TAMANHO.clientesPF + TAMANHO.clientesPJ + 8;
    assert.ok(Math.ceil(total / 20) >= 5, `${total} clientes = ${Math.ceil(total / 20)} páginas`);
    assert.ok(total >= 250 && total <= 270, "o porte da advogada: cerca de 260 clientes");
  });

  test("predominância de pessoa física", () => {
    assert.ok(TAMANHO.clientesPF > TAMANHO.clientesPJ * 5);
  });

  test("TAMANHO é congelado — ninguém o altera em tempo de execução", () => {
    assert.ok(Object.isFrozen(TAMANHO));
  });
});

describe("as tabelas de domínio do frontend", () => {
  test("todo nome do catálogo (classe, assunto, profissão, comarca) existe na tabela", (t) => {
    const pasta = localizarPastaDeTabelas();
    if (!pasta) {
      // Repositório do frontend fora do lugar: o seed PARA com instrução (é o
      // comportamento testado abaixo), mas esta conferência não tem o que ler.
      t.diagnostic("tabelas do frontend não encontradas — conferência de nomes não executada");
      assert.throws(() => carregarTabelas(), /Tabelas de domínio não encontradas/);
      return;
    }

    const tabelas = carregarTabelas();
    const ausentes = [];
    for (const c of BR.CASOS) {
      if (!tabelas.temClasse(c.classe)) ausentes.push(`classe "${c.classe}"`);
      if (!tabelas.temAssuntoRaiz(c.area)) ausentes.push(`assunto "${c.area}"`);
    }
    for (const p of BR.PROFISSOES_CANDIDATAS) if (!tabelas.temProfissao(p)) ausentes.push(`profissão "${p}"`);
    for (const c of ["Ponta Grossa", "Castro", "Palmeira", "Telêmaco Borba", "Tibagi", "Curitiba", "Guarapuava", "Irati"]) {
      if (!tabelas.temComarca(c)) ausentes.push(`comarca "${c}"`);
    }
    assert.deepEqual(ausentes, [], "nomes do volume que a tela não conhece");
    assert.equal(tabelas.gentilico("Brasil", "feminino"), "brasileira");
    assert.equal(tabelas.gentilico("Brasil", "masculino"), "brasileiro");
  });

  test("sem as tabelas, o seed PARA com a instrução — não cai numa lista embutida", () => {
    const antes = process.env.LEX_TABELAS_DIR;
    process.env.LEX_TABELAS_DIR = "/caminho/que/nao/existe";
    try {
      // Só afirma o erro se o caminho padrão (ao lado do repositório) também não existir.
      if (!localizarPastaDeTabelas()) {
        assert.throws(() => carregarTabelas(), /LEX_TABELAS_DIR/);
      } else {
        assert.ok(localizarPastaDeTabelas(), "o caminho padrão existe e serve de segundo lugar");
      }
    } finally {
      if (antes === undefined) delete process.env.LEX_TABELAS_DIR; else process.env.LEX_TABELAS_DIR = antes;
    }
  });
});
