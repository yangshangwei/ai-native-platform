package com.acme.legacy.billing;

public class BillingRefundRepository {
  public RefundAuditResult writeRefundAuditEntry(String refundId) {
    String sql = "CALL rebuild_jaxws_refund_audit(); SELECT * FROM billing.jaxws_refund_audit_entries";
    return new RefundAuditResult(sql);
  }
}
