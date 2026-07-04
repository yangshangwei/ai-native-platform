<?php
class BillingController extends AppController
{
  public function reviewRefund() {
    $service = new BillingRefundService();
    return $service->rebuildCakeRefundReview();
  }
}
