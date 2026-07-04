package com.acme.legacy.billing;

public class BillingRefundManager {
  private final BillingRefundRepository billingRefundRepository = new BillingRefundRepository();

  public RefundAuditResult rebuildRefundAudit(String refundId) {
    return billingRefundRepository.writeRefundAuditEntry(refundId);
  }
}
