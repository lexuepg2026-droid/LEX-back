const DEMONIMOS = {
  "Brasil": { masculino: "brasileiro", feminino: "brasileira" },
  "Portugal": { masculino: "português", feminino: "portuguesa" },
  "Argentina": { masculino: "argentino", feminino: "argentina" },
  "Bolívia": { masculino: "boliviano", feminino: "boliviana" },
  "Chile": { masculino: "chileno", feminino: "chilena" },
  "Colômbia": { masculino: "colombiano", feminino: "colombiana" },
  "Cuba": { masculino: "cubano", feminino: "cubana" },
  "Equador": { masculino: "equatoriano", feminino: "equatoriana" },
  "Guiana": { masculino: "guianense", feminino: "guianense" },
  "Haiti": { masculino: "haitiano", feminino: "haitiana" },
  "México": { masculino: "mexicano", feminino: "mexicana" },
  "Paraguai": { masculino: "paraguaio", feminino: "paraguaia" },
  "Peru": { masculino: "peruano", feminino: "peruana" },
  "República Dominicana": { masculino: "dominicano", feminino: "dominicana" },
  "Suriname": { masculino: "surinamês", feminino: "surinamesa" },
  "Uruguai": { masculino: "uruguaio", feminino: "uruguaia" },
  "Venezuela": { masculino: "venezuelano", feminino: "venezuelana" },
  "Estados Unidos": { masculino: "norte-americano", feminino: "norte-americana" },
  "Canadá": { masculino: "canadense", feminino: "canadense" },
  "Espanha": { masculino: "espanhol", feminino: "espanhola" },
  "França": { masculino: "francês", feminino: "francesa" },
  "Itália": { masculino: "italiano", feminino: "italiana" },
  "Alemanha": { masculino: "alemão", feminino: "alemã" },
  "Reino Unido": { masculino: "britânico", feminino: "britânica" },
  "Holanda": { masculino: "holandês", feminino: "holandesa" },
  "Bélgica": { masculino: "belga", feminino: "belga" },
  "Suíça": { masculino: "suíço", feminino: "suíça" },
  "Áustria": { masculino: "austríaco", feminino: "austríaca" },
  "Suécia": { masculino: "sueco", feminino: "sueca" },
  "Noruega": { masculino: "norueguês", feminino: "norueguesa" },
  "Dinamarca": { masculino: "dinamarquês", feminino: "dinamarquesa" },
  "Polônia": { masculino: "polonês", feminino: "polonesa" },
  "Grécia": { masculino: "grego", feminino: "grega" },
  "Rússia": { masculino: "russo", feminino: "russa" },
  "Ucrânia": { masculino: "ucraniano", feminino: "ucraniana" },
  "Turquia": { masculino: "turco", feminino: "turca" },
  "China": { masculino: "chinês", feminino: "chinesa" },
  "Japão": { masculino: "japonês", feminino: "japonesa" },
  "Coreia do Sul": { masculino: "sul-coreano", feminino: "sul-coreana" },
  "Índia": { masculino: "indiano", feminino: "indiana" },
  "Filipinas": { masculino: "filipino", feminino: "filipina" },
  "Vietnã": { masculino: "vietnamita", feminino: "vietnamita" },
  "Indonésia": { masculino: "indonésio", feminino: "indonésia" },
  "Israel": { masculino: "israelense", feminino: "israelense" },
  "Líbano": { masculino: "libanês", feminino: "libanesa" },
  "Síria": { masculino: "sírio", feminino: "síria" },
  "Angola": { masculino: "angolano", feminino: "angolana" },
  "Moçambique": { masculino: "moçambicano", feminino: "moçambicana" },
  "Cabo Verde": { masculino: "cabo-verdiano", feminino: "cabo-verdiana" },
  "Nigéria": { masculino: "nigeriano", feminino: "nigeriana" },
  "África do Sul": { masculino: "sul-africano", feminino: "sul-africana" },
  "Egito": { masculino: "egípcio", feminino: "egípcia" },
  "Austrália": { masculino: "australiano", feminino: "australiana" },
  "Nova Zelândia": { masculino: "neozelandês", feminino: "neozelandesa" },
};

const calcularNacionalidade = (pais, sexo) => {
  if (!pais) return undefined;

  const entrada = DEMONIMOS[pais];
  if (!entrada) return pais;

  if (sexo === "masculino") return entrada.masculino;
  if (sexo === "feminino") return entrada.feminino;

  return entrada.feminino;
};

export default DEMONIMOS;
export { calcularNacionalidade };