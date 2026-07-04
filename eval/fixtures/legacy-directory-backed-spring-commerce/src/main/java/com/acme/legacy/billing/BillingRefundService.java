package com.acme.legacy.billing;

public class BillingRefundService {
  private final BillingRefundRepository billingRefundRepository = new BillingRefundRepository();

  public RefundAuditResult rebuildRefundAudit(String refundId) {
    return billingRefundRepository.writeRefundAuditEntry(refundId);
  }
}
