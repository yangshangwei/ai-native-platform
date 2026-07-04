<?php

namespace App\Repositories;

class BillingRefundRepository
{
  public function writeRefundAuditEntry($refund) {
    $sql = "CALL rebuild_laravel_refund_audit(); SELECT * FROM billing.laravel_refund_audit_entries";
    return $sql;
  }
}
