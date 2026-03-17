'use strict';

var server = require('server');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var Order = require('dw/order/Order');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');

server.post('Callback', function (req, res, next) {
	try {
		var rawBody = req.httpParameterMap.requestBodyAsString;
		var signatureHeader = req.httpHeaders['stripe-signature'];
		var endpointSecret = Site.getCurrent().getCustomPreferenceValue('stripeWebhookSecret');
		var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers.js');
		var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
		var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService')
		var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
		var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');

		if (!endpointSecret) {
			Logger.error('Unable to get stripeWebhookSecret Custom Preference.');
			res.setStatusCode(200);
			res.json({ error: 'Invalid signature' });
			return next();
		}
		var stripeEvent = JSON.parse(rawBody);
		Logger.info('Stripe stripeEvent received: ' + stripeEvent.type);

		if (!stripeEvent.data.object.metadata.orderNo || !stripeEvent.data.object.metadata.orderToken) {
			Logger.error('Unable to get orderNo and orderToken');
			res.setStatusCode(200);
			res.json({ error: 'Unable to get orderNo and orderToken' });
			return next();
		}

		var orderNumber = stripeEvent.data.object.metadata.orderNo;
		var orderToken = stripeEvent.data.object.metadata.orderToken;
		var order = OrderMgr.getOrder(orderNumber, orderToken);

		if (!order) {
			Logger.error('Order not found for orderNo: {0}', orderNumber);
			res.setStatusCode(200);
			res.json({ error: 'Order not found' });
			return next();
		}

		var isValid = paymentHelpers.verifyStripeSignature(rawBody, signatureHeader, endpointSecret);
		if (!isValid) {
			Logger.error('Stripe signature verification failed');
			Transaction.wrap(function () {
				// @ts-ignore
				order.custom.orderStatus = 8;
				OrderMgr.failOrder(order, true);
			});
			res.setStatusCode(200);
			res.json({ error: 'Invalid signature' });
			return next();
		}

		switch (stripeEvent.type) {
			case 'payment_intent.succeeded':
				var stripePI = stripeEvent.data.object;
				Transaction.wrap(function () {
					var handlePaymentsResult = paymentHelpers.handlePayments(order, stripePI);
					if (handlePaymentsResult.error) {
						// @ts-ignore
						order.custom.orderStatus = 8;
						OrderMgr.failOrder(order, true);
						throw new Error('Payment handling failed for order ' + order.orderNo);
					}
					// @ts-ignore
					order.custom.orderStatus = 0;
					var placeOrderStatus = OrderMgr.placeOrder(order);
					if (placeOrderStatus.isError()) {
						// @ts-ignore
						order.custom.orderStatus = 8;
						OrderMgr.failOrder(order, true);
						throw new Error('Order placement failed for order ' + order.orderNo);
					}
					order.setPaymentStatus(Order.PAYMENT_STATUS_PAID);
					order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);

					paymentHelpers.updateTotalOrdersAndSpent(order);
					sendRefersionDataHelper.sendRefersionData(order);
					var createOrderRes = callCreateSaleOrder(order, function (order, token) {
						return UnicommerceCreatOrderService.createSaleOrder(order, token);
					});
					emailHelper.sendOrderConfirmMail(order);
					if (createOrderRes.object.successful == false) {
						Logger.error('Unicommerce: Failed to create order for Stripe order {0}', order.orderNo);
					} else {
						Logger.info('Unicommerce: Successfully created order for Stripe order {0}.', order.orderNo);
						order.exportStatus = 1;
						order.custom.UpdateFlowFlag = true;
					}
				});

				Logger.info('Payment succeeded and order {0} was placed.', order.orderNo);
				break;
			case 'payment_intent.canceled':
				Transaction.wrap(function () {
					// @ts-ignore
					order.custom.orderStatus = 8;
					OrderMgr.failOrder(order, true);
				});
			case 'payment_intent.payment_failed':
				var stripePI = stripeEvent.data.object;
				var result = paymentHelpers.cancelStripePaymentIntent(stripePI.id);
				if (result && result.error) {
					throw new Error('Unable to cancel payment intent ' + result);
				}
				Transaction.wrap(function () {
					// @ts-ignore
					order.custom.orderStatus = 8;
					OrderMgr.failOrder(order, true);
				});
				Logger.info('Payment canceled: ' + stripePI.id);
				break;
			case 'payment_intent.processing':
				var stripePI = stripeEvent.data.object;
				Logger.info('Payment processing: ' + stripePI.id);
				break;
			default:
				Logger.warn('Unhandled stripeEvent type: ' + stripeEvent.type);
		}
		res.json({ received: true });
	} catch (e) {
		Logger.error('Full stack trace: {0}', e.stack);
		Logger.error('Error Message: {0}', e.message);
		if (order) {
			Transaction.wrap(function () {
				// @ts-ignore
				order.custom.orderStatus = 8;
				OrderMgr.failOrder(order, true);
			});
		}
		res.setStatusCode(200);
		res.json({ error: e.message });
	}

	next();
});

module.exports = server.exports();
