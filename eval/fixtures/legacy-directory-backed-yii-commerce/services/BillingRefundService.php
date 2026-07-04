<?php
class BillingRefundService
{
  public function rebuildYiiRefundReview() {
    $repository = new BillingRefundRepository();
    return $repository->writeYiiRefundReviewEntry();
  }
}
