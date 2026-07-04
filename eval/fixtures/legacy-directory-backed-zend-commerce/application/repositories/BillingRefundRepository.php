<?php
class BillingRefundRepository
{
  public function writeZendRefundReviewEntry() {
    $sql = "CALL rebuild_zend_refund_review(); SELECT * FROM billing.zend_refund_review_entries";
    return $sql;
  }
}
