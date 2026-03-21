'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var Status = require('dw/system/Status');
var Calendar = require('dw/util/Calendar');

var paypalService = require('*/cartridge/services/paypalService');
var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');

exports.updatePayPalOrdersStatus = function () {
	try {
		var cal = Site.getCurrent().getCalendar();
		cal.add(Calendar.DAY_OF_YEAR, -1);
		var oneDayAgo = cal.getTime();

		var orders = OrderMgr.searchOrders(
			'creationDate >= {0} AND status = {1}',
			'creationDate desc',
			oneDayAgo,
			Order.ORDER_STATUS_CREATED
		);

		try {
			while (orders.hasNext()) {
				var order = orders.next();
				var paymentInstrument = paypalHelper.getPayPalPaymentInstrument(order);
				if (!paymentInstrument || !paymentInstrument.custom.paypal_order_id) {
					continue;
				}

				var getOrderResp = paypalService.getOrder({
					paypalOrderId: paymentInstrument.custom.paypal_order_id
				});

				if (!getOrderResp.ok || !getOrderResp.object || !getOrderResp.object.id) {
					Logger.error(
						'PayPal reconciliation failed for order {0}: unable to retrieve PayPal order {1}',
						order.orderNo,
						paymentInstrument.custom.paypal_order_id
					);
					continue;
				}

				var syncResult = paypalHelper.syncOrderWithPayPal(order, getOrderResp.object);
				if (!syncResult.success) {
					Logger.warn(
						'PayPal reconciliation could not finalize order {0}: {1}',
						order.orderNo,
						syncResult.message || 'Unknown PayPal state'
					);
				}
			}
		} finally {
			if (orders) {
				orders.close();
			}
		}

		return new Status(Status.OK, 'OK', 'PayPal order reconciliation completed successfully.');
	} catch (e) {
		Logger.error('Error updating PayPal order status: {0}', e.message);
		return new Status(Status.ERROR, 'ERROR', 'PayPal order reconciliation failed: ' + e.message);
	}
};
