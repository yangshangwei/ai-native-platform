const CustomerLedgerService = require('../services/customer-ledger-service');

module.exports = {
  showLedger(req, res) {
    const service = new CustomerLedgerService();
    return service.showLedger(req.params.customerId);
  }
};
