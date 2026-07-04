package com.acme.legacy.billing;
import javax.jws.WebMethod;
import javax.jws.WebService;

@WebService(serviceName = "BillingRefundService")
public class BillingRefundService {
  private final BillingRefundManager billingRefundManager = new BillingRefundManager();

  @WebMethod(operationName = "AuditRefund")
  public RefundAuditResult auditRefund(String refundId) {
    return billingRefundManager.rebuildRefundAudit(refundId);
  }
}
