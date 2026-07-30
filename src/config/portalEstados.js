// Estado de um participante no portal, para a interface da Fase 3.2.
//
// Vocabulário FECHADO, como `integrityConflicts.js` e `portalErrors.js`: a tela
// vai rotear por estes valores, e roteamento não pode depender de texto.
//
// Vive em `config/` e não no service de confirmação porque é função PURA do
// vínculo — depende só de dois campos desnormalizados nele. Deixá-la no service
// obrigaria `processoClienteService` a importar `confirmacaoService`, que
// importa `portalService`, para calcular um `if`.
//
// A diferença entre `nunca_acessou` e `acessou_sem_confirmar` é a que a
// advogada olha antes de ligar cobrando ciência: "não abriu" e "abriu e não
// declarou" pedem conversas diferentes, e um estado só juntaria as duas.

export const ESTADO_PORTAL = Object.freeze({
  NUNCA_ACESSOU: "nunca_acessou",
  ACESSOU_SEM_CONFIRMAR: "acessou_sem_confirmar",
  CONFIRMOU: "confirmou"
});

export const ESTADOS_PORTAL = Object.freeze(Object.values(ESTADO_PORTAL));

export const estadoDoParticipante = (vinculo) => {
  if (vinculo?.ultimaConfirmacaoEm) return ESTADO_PORTAL.CONFIRMOU;
  if (vinculo?.primeiroAcessoPortal) return ESTADO_PORTAL.ACESSOU_SEM_CONFIRMAR;
  return ESTADO_PORTAL.NUNCA_ACESSOU;
};

export default ESTADO_PORTAL;
