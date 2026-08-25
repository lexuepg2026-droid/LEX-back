import { lerCalendario, lerAvisos } from "../services/calendarService.js";

export const getCalendar = async (req, res, next) => {
  try {
    const { de, ate, processoId } = req.query;
    const resultado = await lerCalendario(req.user._id, { de, ate, processoId });
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const getAvisos = async (req, res, next) => {
  try {
    const resultado = await lerAvisos(req.user._id);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};
