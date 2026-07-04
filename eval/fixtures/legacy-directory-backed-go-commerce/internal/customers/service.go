package customers

type CustomerProfileService struct {}

func NewCustomerProfileService() *CustomerProfileService { return &CustomerProfileService{} }

func (s *CustomerProfileService) ReviewProfileRisk(customerID string) CustomerRiskResult {
  repo := &CustomerProfileRepository{}
  return repo.LoadProfileRiskSnapshot(customerID)
}
