import { Router } from "express";
import { approveRefund } from "../billing/refund-controller";
import { showCustomer } from "../customers/customer-controller";

export const router = Router();
router.post("/api/v1/billing/refunds/:refundId/approve", approveRefund);
router.get("/api/v1/customers/:customerId", showCustomer);
