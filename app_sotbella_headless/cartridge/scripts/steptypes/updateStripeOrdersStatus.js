'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Calendar = require('dw/util/Calendar');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var Status = require('dw/system/Status');
var Transaction = require('dw/system/Transaction');
var Order = require('dw/order/Order');

exports.updateStripeOrdersStatus = function () {
	var stripeService = require('../../services/stripeService');
	var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers.js');
	var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
	var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService')
	var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
	var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');


	try {
		var cal = Site.getCurrent().getCalendar();
		// For futher testing process
		// var cal = new Calendar(new Date(2025, 9, 9, 17, 1, 0));
		cal.add(Calendar.HOUR, -1);
		var oneHourAgo = cal.getTime();

		var queryString = 'creationDate >= {0} AND status = {1}';
		var sortString = 'creationDate desc';

		// For futher testing process
		// var queryString = 'orderNo = {0}';
		// var sortString = null;

		var orders = OrderMgr.searchOrders(queryString, sortString, oneHourAgo, dw.order.Order.ORDER_STATUS_CREATED);
		// var orders = OrderMgr.searchOrders(queryString, sortString, '00000904');

		while (orders.hasNext()) {
			var order = /** @type {dw.order.Order} */ (orders.next());
			var paymentInstruments = order.getPaymentInstruments();
			if (order && paymentInstruments) {
				for (var i = 0; i < paymentInstruments.length; i++) {
					var paymentInstrument = paymentInstruments[i];
					if (paymentInstrument.getPaymentMethod() === 'STRIPE') {
						var paymentIntentId = paymentInstrument.custom.stripe_payment_intent_id;
						if (paymentIntentId) {
							var createResp = stripeService.retrievePaymentIntent.call({
								paymentIntentId: paymentIntentId,
							});
							Transaction.wrap(function () {
								if (createResp.ok && createResp.object && createResp.object.id) {
									switch (createResp.object.status) {
										case 'succeeded':
											var handlePaymentsResult = paymentHelpers.handlePayments(
												order,
												createResp.object
											);
											if (handlePaymentsResult.error) {
												// @ts-ignore
												order.custom.orderStatus = 8;
												OrderMgr.failOrder(order, true);
												throw new Error('Payment handling failed for order ' + order.orderNo);
											}
											// @ts-ignore
											order.custom.orderStatus = 1;
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

											break;
										case 'canceled':
											var stripePI = createResp.object;
											Transaction.wrap(function () {
												// @ts-ignore
												order.custom.orderStatus = 8;
												OrderMgr.failOrder(order, true);
											});
											Logger.info('Payment canceled: ' + stripePI.id);
											break;
										case 'payment_failed':
											var stripePI = createResp.object;
											Transaction.wrap(function () {
												// @ts-ignore
												order.custom.orderStatus = 8;
												OrderMgr.failOrder(order, true);
											});
											Logger.info('Payment failed: ' + stripePI.id);
											break;
										case 'processing':
											var stripePI = createResp.object;
											Logger.info('Payment processing: ' + stripePI.id);
											break;
										default:
											Logger.warn('Unhandled event type: ' + createResp.status);
									}
								} else {
									Logger.error('Stripe: Failed get Payment Intent: {0}.', paymentIntentId);
									return;
								}
							});
						}
					}
				}
			}
		}

		return new Status(Status.OK, 'OK', 'Job finished successfully.');
	} catch (e) {
		Logger.error('Error updating Stripe order status: ' + e.toString());
		return new Status(Status.ERROR, 'ERROR', 'Job failed with error: ' + e.message);
	}
};