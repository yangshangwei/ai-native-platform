class BillingRefundRepository:
    def write_refund_audit_entry(self, refund_id):
        sql = "CALL rebuild_refund_audit_entry(); SELECT * FROM billing.refund_audit_entries"
        return sql
