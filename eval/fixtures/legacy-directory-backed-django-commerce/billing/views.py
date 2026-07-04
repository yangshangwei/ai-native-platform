from .services import BillingRefundService

def refund_audit(request, refund_id):
    service = BillingRefundService()
    return service.rebuild_refund_audit(refund_id)
