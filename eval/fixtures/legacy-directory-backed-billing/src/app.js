const express = require('express');
const billingRoutes = require('./routes/billing-routes');
const customerRoutes = require('./routes/customer-routes');

const app = express();

app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/customers', customerRoutes);

module.exports = app;
