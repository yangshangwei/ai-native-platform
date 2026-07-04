<?php
class BillingRefundRepository
{
  public function writeYiiRefundReviewEntry() {
    $sql = "CALL rebuild_yii_refund_review(); SELECT * FROM billing.yii_refund_review_entries";
    return $sql;
  }
}
