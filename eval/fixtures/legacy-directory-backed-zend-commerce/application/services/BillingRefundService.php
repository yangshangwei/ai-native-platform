<?php
class BillingRefundService
{
  public function rebuildZendRefundReview() {
    $repository = new BillingRefundRepository();
    return $repository->writeZendRefundReviewEntry();
  }
}
