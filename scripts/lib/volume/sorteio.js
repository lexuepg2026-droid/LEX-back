// ═══════════════════════════════════════════════════════════════════════════
// SORTEIO DETERMINÍSTICO — o volume do seed (seed:demo:volume)
//
// Mulberry32: um gerador pseudoaleatório de 32 bits, com semente. **Mesma
// semente, mesma base** — é o que faz o volume ser reproduzível. Rodar o seed
// no banco de desenvolvimento e no de produção produz os MESMOS clientes,
// processos e valores, e quem revisar a tela num ambiente vê o que o outro viu.
//
// `Math.random()` não serve aqui: sem semente, cada execução inventa uma base
// diferente, e "aquele cliente da página 3" deixa de existir na próxima.
// ═══════════════════════════════════════════════════════════════════════════

export const criarSorteio = (semente) => {
  let estado = semente >>> 0;

  const proximo = () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Inteiro em [min, max], inclusive nos dois.
  const inteiro = (min, max) => Math.floor(proximo() * (max - min + 1)) + min;

  const escolher = (lista) => {
    if (!Array.isArray(lista) || lista.length === 0) {
      throw new Error("sorteio.escolher: lista vazia");
    }
    return lista[Math.floor(proximo() * lista.length)];
  };

  const chance = (probabilidade) => proximo() < probabilidade;

  // pares: [[valor, peso], ...]. O peso é relativo, não precisa somar 1.
  const ponderado = (pares) => {
    const total = pares.reduce((soma, [, peso]) => soma + peso, 0);
    let ponto = proximo() * total;
    for (const [valor, peso] of pares) {
      ponto -= peso;
      if (ponto < 0) return valor;
    }
    return pares[pares.length - 1][0];
  };

  // Fisher-Yates, sem alterar a lista recebida.
  const embaralhar = (lista) => {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i -= 1) {
      const j = Math.floor(proximo() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  };

  return { proximo, inteiro, escolher, chance, ponderado, embaralhar };
};

export default criarSorteio;
