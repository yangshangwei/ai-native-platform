<?php
class BillingRefundRepository
{
  public function writeCodeIgniterRefundAuditEntry() {
    $sql = "CALL rebuild_codeigniter_refund_audit(); SELECT * FROM billing.codeigniter_refund_audit_entries";
    return $sql;
  }
}
