<?php
class OrderBacklogService
{
  public function repriceBacklog() {
    $repository = new OrderBacklogRepository();
    return $repository->loadBacklog();
  }
}
