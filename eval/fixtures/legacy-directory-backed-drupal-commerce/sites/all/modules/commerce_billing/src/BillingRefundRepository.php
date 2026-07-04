<?php
class BillingRefundRepository
{
  public function writeDrupalRefundReviewEntry($refundId) {
    $sql = "CALL rebuild_drupal_refund_review(); SELECT * FROM billing.drupal_refund_review_entries";
    return $sql;
  }
}
