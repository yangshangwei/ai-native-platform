package com.acme.legacy.billing;

@RestController
@RequestMapping("/api/v5/billing")
public class BillingRefundController {
  private final BillingRefundService billingRefundService = new BillingRefundService();

  @PostMapping("/refunds/{refundId}/audit")
  public ResponseEntity<?> auditRefund(String refundId) {
    return ResponseEntity.ok(billingRefundService.rebuildRefundAudit(refundId));
  }
}
