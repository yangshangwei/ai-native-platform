<?php
class BacklogController
{
  public function repriceAction() {
    $service = new OrderBacklogService();
    return $service->repriceBacklog();
  }
}
