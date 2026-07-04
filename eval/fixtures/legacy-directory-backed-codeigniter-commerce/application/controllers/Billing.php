<?php
class Billing extends CI_Controller
{
  public function auditRefund() {
    $service = new BillingRefundService();
    return $service->rebuildCodeIgniterRefundAudit();
  }
}
