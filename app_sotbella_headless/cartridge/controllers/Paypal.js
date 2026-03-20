'use strict';

var server = require('server');
var Logger = require('dw/system/Logger');

var paypalService = require('*/cartridge/services/paypalService');
var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');

function getHeader(req, name) {
	return req.httpHeaders[name] || req.httpHeaders[name.toLowerCase()] || req.httpHeaders[name.toUpperCase()];
}

server.post('Webhook', server.middleware.https, function (req, res, next) {
	try {
		var rawBody = req.httpParameterMap.requestBodyAsString;
		if (!rawBody) {
			res.setStatusCode(400);
			res.json({ success: false, message: 'Missing webhook payload' });
			return next();
		}

		var webhookEvent = JSON.parse(rawBody);
		var headers = {
			authAlgo: getHeader(req, 'paypal-auth-algo'),
			certUrl: getHeader(req, 'paypal-cert-url'),
			transmissionId: getHeader(req, 'paypal-transmission-id'),
			transmissionSig: getHeader(req, 'paypal-transmission-sig'),
			transmissionTime: getHeader(req, 'paypal-transmission-time')
		};

		var verified = paypalHelper.verifyWebhook(headers, rawBody, webhookEvent);
		if (!verified) {
			res.setStatusCode(400);
			res.json({ success: false, message: 'Invalid PayPal webhook signature' });
			return next();
		}

		var resource = webhookEvent.resource || {};
		var paypalOrderId =
			(resource.supplementary_data &&
				resource.supplementary_data.related_ids &&
				resource.supplementary_data.related_ids.order_id) ||
			resource.id;
		var order = paypalHelper.resolveOrder(webhookEvent.resource, null, null, paypalOrderId);

		if (!order) {
			Logger.warn('PayPal webhook received for unknown order. PayPal Order ID: {0}', paypalOrderId);
			res.json({ success: true, received: true, ignored: true });
			return next();
		}

		var eventType = webhookEvent.event_type;
		var getOrderResp = paypalOrderId
			? paypalService.getOrder({
				paypalOrderId: paypalOrderId
			})
			: null;
		var paypalOrder = getOrderResp && getOrderResp.ok && getOrderResp.object && getOrderResp.object.id
			? getOrderResp.object
			: null;

		if (!paypalOrder && order) {
			var paymentInstrument = paypalHelper.getPayPalPaymentInstrument(order);
			if (paymentInstrument && paymentInstrument.custom.paypal_order_id) {
				paypalOrder = {
					id: paymentInstrument.custom.paypal_order_id,
					status: resource.status || '',
					payer: resource.payer || null,
					purchase_units: [
						{
							custom_id: resource.custom_id,
							invoice_id: resource.invoice_id,
							payments: {
								captures: [resource]
							}
						}
					]
				};
			}
		}

		switch (eventType) {
			case 'CHECKOUT.ORDER.APPROVED':
			case 'CHECKOUT.ORDER.COMPLETED':
			case 'PAYMENT.CAPTURE.COMPLETED':
			case 'PAYMENT.CAPTURE.PENDING':
				if (paypalOrder) {
					paypalHelper.syncOrderWithPayPal(order, paypalOrder);
				}
				break;
			case 'PAYMENT.CAPTURE.DENIED':
			case 'CHECKOUT.ORDER.DECLINED':
			case 'CHECKOUT.PAYMENT-APPROVAL.REVERSED':
				paypalHelper.failPayPalOrder(order, paypalOrder, eventType);
				break;
			default:
				Logger.info('Unhandled PayPal webhook event: {0}', eventType);
		}

		res.json({ success: true, received: true });
	} catch (e) {
		Logger.error('PayPal Webhook failed: {0}', e.message);
		res.setStatusCode(500);
		res.json({ success: false, message: e.message });
	}

	return next();
});

module.exports = server.exports();
