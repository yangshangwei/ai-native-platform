<?php
class BillingRefundService
{
  public function rebuildDrupalRefundReview($refundId) {
    $repository = new BillingRefundRepository();
    return $repository->writeDrupalRefundReviewEntry($refundId);
  }
}
