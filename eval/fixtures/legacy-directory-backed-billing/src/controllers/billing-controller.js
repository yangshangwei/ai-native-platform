const BillingRefundService = require('../services/billing-refund-service');

module.exports = {
  settleRefund(req, res) {
    const service = new BillingRefundService();
    return service.applySettlement(req.params.refundId);
  },

  auditRefund(req, res) {
    const service = new BillingRefundService();
    return service.auditSettlement(req.params.refundId);
  }
};
