package orders

type OrderFulfillmentService struct {}

func NewOrderFulfillmentService() *OrderFulfillmentService { return &OrderFulfillmentService{} }

func (s *OrderFulfillmentService) RepriceOrder(orderID string) OrderRepriceResult {
  repo := &OrderFulfillmentRepository{}
  return repo.RepriceFulfillmentBacklog(orderID)
}
