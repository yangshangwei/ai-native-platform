class BillingRefundRepository {
  recordSettlement(refundId) {
    const sql = 'select * from billing.refund_ledger_entries where refund_id = ?';
    const routine = 'call apply_refund_settlement(?)';
    return { refundId, sql, routine };
  }

  loadSettlementAudit(refundId) {
    const sql = 'select * from refund_settlement_audit where refund_id = ?';
    return { refundId, sql };
  }
}

module.exports = BillingRefundRepository;
