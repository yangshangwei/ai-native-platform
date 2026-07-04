package com.acme.legacy.billing;

public class BillingRefundRepository {
  public RefundAuditResult writeRefundAuditEntry(String refundId) {
    String sql = "CALL rebuild_struts_refund_audit(); SELECT * FROM billing.struts_refund_audit_entries";
    return new RefundAuditResult(sql);
  }
}
