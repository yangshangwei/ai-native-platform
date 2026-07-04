<?php

namespace App\Services;

use App\Repositories\BillingRefundRepository;

class BillingRefundService
{
  public function rebuildRefundAudit($refund) {
    $repository = new BillingRefundRepository();
    return $repository->writeRefundAuditEntry($refund);
  }
}
