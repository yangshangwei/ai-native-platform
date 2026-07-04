class CustomerLedgerRepository {
  loadCustomerLedger(customerId) {
    const sql = 'select * from customer_account_ledgers where customer_id = ?';
    return { customerId, sql };
  }
}

module.exports = CustomerLedgerRepository;
