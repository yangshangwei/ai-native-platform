from .repositories import BillingRefundRepository

class BillingRefundService:
    def rebuild_refund_audit(self, refund_id):
        repository = BillingRefundRepository()
        return repository.write_refund_audit_entry(refund_id)
