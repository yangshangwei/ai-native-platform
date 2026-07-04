package com.acme.legacy.billing;

public class BillingRefundServiceTest {
  public void rebuildsRefundAuditThroughSoapService() {
    new BillingRefundService().auditRefund("refund-1024");
  }
}
