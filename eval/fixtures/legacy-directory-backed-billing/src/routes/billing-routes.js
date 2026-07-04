const express = require('express');
const billingController = require('../controllers/billing-controller');

const router = express.Router();

router.post('/refunds/:refundId/settle', billingController.settleRefund);
router.get('/refunds/:refundId/audit', billingController.auditRefund);

module.exports = router;
