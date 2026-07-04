import { BillingRefundRepository } from "./refund-repository";

export class BillingRefundService {
  approveRefund(refundId: string) {
    const repository = new BillingRefundRepository();
    return repository.markApproved(refundId);
  }
}
