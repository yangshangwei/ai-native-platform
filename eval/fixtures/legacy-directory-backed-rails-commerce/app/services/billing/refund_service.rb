require_dependency "billing/refund_repository"

class Billing::RefundService
  def audit_refund(refund_id)
    repository = Billing::RefundRepository.new
    repository.audit_refund(refund_id)
  end
end
