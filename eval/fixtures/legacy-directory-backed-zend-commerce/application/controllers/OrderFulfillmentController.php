<?php
class OrderFulfillmentController extends Zend_Controller_Action
{
  public function repriceAction() {
    $service = new OrderFulfillmentService();
    return $service->repriceZendFulfillment();
  }
}
