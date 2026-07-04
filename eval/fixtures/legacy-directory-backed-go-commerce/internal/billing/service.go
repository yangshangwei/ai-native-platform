package billing

type BillingRefundService struct {}

func NewBillingRefundService() *BillingRefundService { return &BillingRefundService{} }

func (s *BillingRefundService) RebuildRefundAudit(refundID string) RefundAuditResult {
  repo := &BillingRefundRepository{}
  return repo.WriteRefundAuditEntry(refundID)
}
