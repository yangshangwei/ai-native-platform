<?php
class BillingRefundController extends Zend_Controller_Action
{
  public function reviewAction() {
    $service = new BillingRefundService();
    return $service->rebuildZendRefundReview();
  }
}
