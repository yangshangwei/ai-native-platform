class Orders::FulfillmentRepository
  def reprice_backlog(order_id)
    sql = "SELECT * FROM order_fulfillment_backlog WHERE order_id = #{order_id}"
    sql
  end
end
