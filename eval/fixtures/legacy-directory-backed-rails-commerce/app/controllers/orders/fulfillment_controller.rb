require_dependency "orders/fulfillment_service"

class Orders::FulfillmentController < ApplicationController
  def reprice
    service = Orders::FulfillmentService.new
    render json: service.reprice_backlog(params[:order_id])
  end
end
