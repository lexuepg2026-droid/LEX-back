import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// AS TABELAS DE DOMÍNIO DO FRONTEND (F-4, DEC-057) — lidas, e não copiadas
//
// Comarcas do PR, profissões (CBO), nacionalidades e classes/assuntos do CNJ
// moram em `lex-frontend/public/tabelas/*.json`. O seed as LÊ de lá: copiá-las
// para o backend criaria uma segunda fonte, e o dia em que uma fosse atualizada
// o volume passaria a sugerir uma comarca que a tela não conhece.
//
// Onde procurar, em ordem:
//   1. `LEX_TABELAS_DIR` (caminho explícito);
//   2. `../lex-frontend/public/tabelas`, ao lado deste repositório.
//
// Sem elas o seed PARA, com a instrução — não cai em lista embutida. Um volume
// "realista" com comarca inventada seria exatamente o defeito que a F-4 fechou.
// ═══════════════════════════════════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = path.resolve(AQUI, "..", "..", "..");

export const localizarPastaDeTabelas = () => {
  const candidatas = [
    process.env.LEX_TABELAS_DIR,
    path.resolve(RAIZ_BACKEND, "..", "lex-frontend", "public", "tabelas")
  ].filter(Boolean);

  return candidatas.find((pasta) => fs.existsSync(path.join(pasta, "comarcas-pr.json"))) ?? null;
};

const ler = (pasta, arquivo) =>
  JSON.parse(fs.readFileSync(path.join(pasta, arquivo), "utf8"));

const semAcento = (texto) =>
  String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export const carregarTabelas = () => {
  const pasta = localizarPastaDeTabelas();
  if (!pasta) {
    throw new Error(
      "Tabelas de domínio não encontradas.\n" +
      "O volume usa comarcas, profissões, nacionalidades e classes do CNJ do frontend.\n" +
      "Deixe o repositório `lex-frontend` ao lado deste (../lex-frontend) ou aponte\n" +
      "LEX_TABELAS_DIR para a pasta `public/tabelas` dele."
    );
  }

  const comarcas = ler(pasta, "comarcas-pr.json").itens;
  const profissoes = ler(pasta, "profissoes-cbo.json").itens;
  const nacionalidades = ler(pasta, "nacionalidades.json").itens;
  const cnj = ler(pasta, "classes-assuntos-cnj.json");

  const nomesDeComarca = new Set(comarcas.map((c) => c.nome));
  const nomesDeProfissao = new Set(profissoes.map((p) => p.nome));
  const nomesDeClasse = new Set(cnj.classes.map((c) => c.nome));
  const raizesDeAssunto = new Set(cnj.assuntos.filter((a) => !a.pai).map((a) => a.nome));

  return {
    pasta,
    comarcas,
    profissoes,
    nacionalidades,
    classes: cnj.classes,
    assuntos: cnj.assuntos,

    temComarca: (nome) => nomesDeComarca.has(nome),
    temProfissao: (nome) => nomesDeProfissao.has(nome),
    temClasse: (nome) => nomesDeClasse.has(nome),
    temAssuntoRaiz: (nome) => raizesDeAssunto.has(nome),

    // O gentílico exatamente como a tela o gravaria (texto, não código).
    gentilico: (pais, sexo) => {
      const item = nacionalidades.find((n) => semAcento(n.pais) === semAcento(pais));
      if (!item) return null;
      return sexo === "masculino" ? item.masculino : item.feminino;
    }
  };
};

export default carregarTabelas;
