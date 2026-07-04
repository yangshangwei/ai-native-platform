<?php
class BillingRefundService
{
  public function rebuildCodeIgniterRefundAudit() {
    $repository = new BillingRefundRepository();
    return $repository->writeCodeIgniterRefundAuditEntry();
  }
}
