package com.acme.legacy.billing;

public class BillingRefundAuditAction extends ActionSupport {
  private final BillingRefundService billingRefundService = new BillingRefundService();

  public String execute() {
    billingRefundService.rebuildRefundAudit(refundId);
    return SUCCESS;
  }
}
