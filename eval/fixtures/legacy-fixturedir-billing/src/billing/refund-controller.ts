import { BillingRefundService } from "./refund-service";

export function approveRefund(req: unknown) {
  const service = new BillingRefundService();
  return service.approveRefund("refund_123");
}
