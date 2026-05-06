// src/services/paymentService.js
import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Installment from "../models/Installment.js";

class PaymentService {
  criarErro(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  validarObjectId(id, nomeCampo) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw this.criarErro(400, `${nomeCampo} inválido`);
    }
  }

  async validarInstallmentDoUsuario(installmentId, usuarioId) {
    this.validarObjectId(installmentId, "installmentId");

    const installment = await Installment.findOne({
      _id: installmentId,
      usuarioId,
      ativo: true
    });

    if (!installment) {
      throw this.criarErro(404, "Parcela não encontrada");
    }

    return installment;
  }

  definirStatusInstallment(installment, totalPago) {
    if (totalPago >= installment.valor) {
      return "pago";
    }

    const hoje = new Date();
    const dataVencimento = new Date(installment.dataVencimento);

    if (dataVencimento < hoje) {
      return "vencido";
    }

    return "pendente";
  }

  async recalcularStatusInstallment(installmentId, usuarioId) {
    const installment = await Installment.findOne({
      _id: installmentId,
      usuarioId,
      ativo: true
    });

    if (!installment) {
      return null;
    }

    const pagamentos = await Payment.find({
      installmentId,
      usuarioId,
      ativo: true
    }).sort({ dataPagamento: -1, createdAt: -1 });

    const totalPago = pagamentos.reduce(
      (total, payment) => total + Number(payment.valorPago),
      0
    );

    const statusFinal = this.definirStatusInstallment(installment, totalPago);

    installment.status = statusFinal;
    installment.dataPagamento =
      statusFinal === "pago" && pagamentos.length > 0
        ? pagamentos[0].dataPagamento
        : null;

    await installment.save();

    return installment;
  }

  async create(data, usuarioId) {
    const installment = await this.validarInstallmentDoUsuario(
      data.installmentId,
      usuarioId
    );

    const novoPagamento = await Payment.create({
      usuarioId,
      installmentId: installment._id,
      valorPago: Number(data.valorPago),
      dataPagamento: new Date(data.dataPagamento),
      formaPagamento: data.formaPagamento,
      observacoes: data.observacoes?.trim() || "",
      ativo: data.ativo !== undefined ? data.ativo : true
    });

    await this.recalcularStatusInstallment(installment._id, usuarioId);

    return await Payment.findById(novoPagamento._id).populate("installmentId");
  }

  async findAll(usuarioId) {
    return await Payment.find({
      usuarioId,
      ativo: true
    })
      .populate("installmentId")
      .sort({ createdAt: -1 });
  }

  async findById(id, usuarioId) {
    this.validarObjectId(id, "paymentId");

    const payment = await Payment.findOne({
      _id: id,
      usuarioId,
      ativo: true
    }).populate("installmentId");

    if (!payment) {
      throw this.criarErro(404, "Pagamento não encontrado");
    }

    return payment;
  }

  async update(id, data, usuarioId) {
    this.validarObjectId(id, "paymentId");

    const payment = await Payment.findOne({
      _id: id,
      usuarioId,
      ativo: true
    });

    if (!payment) {
      throw this.criarErro(404, "Pagamento não encontrado");
    }

    const installmentOriginalId = payment.installmentId.toString();

    if (data.installmentId !== undefined) {
      const installment = await this.validarInstallmentDoUsuario(
        data.installmentId,
        usuarioId
      );
      payment.installmentId = installment._id;
    }

    if (data.valorPago !== undefined) {
      payment.valorPago = Number(data.valorPago);
    }

    if (data.dataPagamento !== undefined) {
      payment.dataPagamento = new Date(data.dataPagamento);
    }

    if (data.formaPagamento !== undefined) {
      payment.formaPagamento = data.formaPagamento;
    }

    if (data.observacoes !== undefined) {
      payment.observacoes = data.observacoes?.trim() || "";
    }

    if (data.ativo !== undefined) {
      payment.ativo = data.ativo;
    }

    await payment.save();

    await this.recalcularStatusInstallment(installmentOriginalId, usuarioId);

    if (payment.installmentId.toString() !== installmentOriginalId) {
      await this.recalcularStatusInstallment(
        payment.installmentId.toString(),
        usuarioId
      );
    }

    return await Payment.findById(payment._id).populate("installmentId");
  }

  async remove(id, usuarioId) {
    this.validarObjectId(id, "paymentId");

    const payment = await Payment.findOne({
      _id: id,
      usuarioId,
      ativo: true
    });

    if (!payment) {
      throw this.criarErro(404, "Pagamento não encontrado");
    }

    payment.ativo = false;
    await payment.save();

    await this.recalcularStatusInstallment(
      payment.installmentId.toString(),
      usuarioId
    );

    return {
      message: "Pagamento removido com sucesso"
    };
  }
}

export default new PaymentService();