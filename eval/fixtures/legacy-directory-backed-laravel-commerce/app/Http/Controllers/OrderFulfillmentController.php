<?php

class OrderFulfillmentController extends Controller
{
  public function repriceFulfillment($order) {
    $service = new \App\Services\OrderFulfillmentService();
    return response()->json($service->repriceOrder($order));
  }
}
