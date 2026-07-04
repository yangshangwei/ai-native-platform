const BillingRefundRepository = require('../repositories/billing-refund-repository');

class BillingRefundService {
  applySettlement(refundId) {
    const repository = new BillingRefundRepository();
    return repository.recordSettlement(refundId);
  }

  auditSettlement(refundId) {
    const repository = new BillingRefundRepository();
    return repository.loadSettlementAudit(refundId);
  }
}

module.exports = BillingRefundService;
