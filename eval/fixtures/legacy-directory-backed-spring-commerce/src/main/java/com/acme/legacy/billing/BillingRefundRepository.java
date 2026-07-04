package com.acme.legacy.billing;

public class BillingRefundRepository {
  public RefundAuditResult writeRefundAuditEntry(String refundId) {
    String sql = "CALL rebuild_spring_refund_audit(); SELECT * FROM billing.spring_refund_audit_entries";
    return new RefundAuditResult(sql);
  }
}
