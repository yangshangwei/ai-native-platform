Rails.application.routes.draw do
  scope "/api/v1" do
    post "/billing/refunds/:refund_id/audit", to: "billing/refunds#audit"
    patch "/orders/fulfillment/:order_id/reprice", to: "orders/fulfillment#reprice"
    get "/customers/profile/:customer_id", to: "customers/profile#show"
  end
end
