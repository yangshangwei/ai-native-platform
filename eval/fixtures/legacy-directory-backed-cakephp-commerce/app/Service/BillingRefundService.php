<?php
class BillingRefundService
{
  public function rebuildCakeRefundReview() {
    $repository = new BillingRefundRepository();
    return $repository->writeCakeRefundReviewEntry();
  }
}
