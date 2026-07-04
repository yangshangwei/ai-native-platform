package customers

type CustomerProfileRepository struct {}

func (r *CustomerProfileRepository) LoadProfileRiskSnapshot(customerID string) CustomerRiskResult {
  sql := "SELECT * FROM customers.go_customer_profile_snapshots WHERE customer_id = ?"
  return CustomerRiskResult{SQL: sql}
}
