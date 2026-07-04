require_dependency "orders/fulfillment_repository"

class Orders::FulfillmentService
  def reprice_backlog(order_id)
    repository = Orders::FulfillmentRepository.new
    repository.reprice_backlog(order_id)
  end
end
