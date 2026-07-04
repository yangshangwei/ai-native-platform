package billing

type BillingRefundRepository struct {}

func (r *BillingRefundRepository) WriteRefundAuditEntry(refundID string) RefundAuditResult {
  sql := "CALL rebuild_go_refund_audit(); SELECT * FROM billing.go_refund_audit_entries"
  return RefundAuditResult{SQL: sql}
}
