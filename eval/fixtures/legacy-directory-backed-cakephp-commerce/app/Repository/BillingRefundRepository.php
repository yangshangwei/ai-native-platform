<?php
class BillingRefundRepository
{
  public function writeCakeRefundReviewEntry() {
    $sql = "CALL rebuild_cake_refund_review(); SELECT * FROM billing.cake_refund_review_entries";
    return $sql;
  }
}
