<?php
class OrderFulfillmentController extends \yii\web\Controller
{
  public function actionReprice() {
    $service = new OrderFulfillmentService();
    return $service->repriceYiiFulfillment();
  }
}
