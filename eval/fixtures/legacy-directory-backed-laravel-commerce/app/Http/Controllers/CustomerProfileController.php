<?php

class CustomerProfileController extends Controller
{
  public function reviewRisk($customer) {
    $service = new \App\Services\CustomerProfileService();
    return response()->json($service->reviewProfileRisk($customer));
  }
}
