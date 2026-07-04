const CustomerLedgerRepository = require('../repositories/customer-ledger-repository');

class CustomerLedgerService {
  showLedger(customerId) {
    const repository = new CustomerLedgerRepository();
    return repository.loadCustomerLedger(customerId);
  }
}

module.exports = CustomerLedgerService;
