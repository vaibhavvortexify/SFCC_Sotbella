'use strict';

var server = require('server');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

var paypalService = require('*/cartridge/services/paypalService');
var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');

function getHeader(req, name) {
	return req.httpHeaders[name] || req.httpHeaders[name.toLowerCase()] || req.httpHeaders[name.toUpperCase()];
}

function buildRedirectUrl(baseUrl, payload) {
	var parts = [];
	var keys = Object.keys(payload || {});
	for (var i = 0; i < keys.length; i++) {
		if (payload[keys[i]] !== null && payload[keys[i]] !== undefined && payload[keys[i]] !== '') {
			parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(String(payload[keys[i]])));
		}
	}

	if (!parts.length) {
		return baseUrl;
	}

	return baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
}

function redirectOrRespond(res, preferenceId, payload) {
	var redirectUrl = Site.getCurrent().getCustomPreferenceValue(preferenceId);
	if (redirectUrl) {
		res.redirect(buildRedirectUrl(String(redirectUrl), payload));
		return;
	}

	res.json(payload);
}

server.get('Return', server.middleware.https, function (req, res, next) {
	try {
		var paypalOrderId = req.querystring.token;
		var orderNo = req.querystring.orderNo;
		var orderToken = req.querystring.orderToken;

		if (!paypalOrderId) {
			res.setStatusCode(400);
			redirectOrRespond(res, 'paypalReturnRedirectUrl', {
				success: false,
				status: 'FAILED',
				message: 'Missing PayPal token'
			});
			return next();
		}

		var getOrderResp = paypalService.getOrder({
			paypalOrderId: paypalOrderId
		});

		if (!getOrderResp.ok || !getOrderResp.object || !getOrderResp.object.id) {
			res.setStatusCode(500);
			redirectOrRespond(res, 'paypalReturnRedirectUrl', {
				success: false,
				status: 'FAILED',
				message: 'Unable to retrieve PayPal order'
			});
			return next();
		}

		var order = paypalHelper.resolveOrder(getOrderResp.object, orderNo, orderToken, paypalOrderId);
		if (!order) {
			res.setStatusCode(404);
			redirectOrRespond(res, 'paypalReturnRedirectUrl', {
				success: false,
				status: 'FAILED',
				message: 'SFCC order not found for PayPal response',
				paypalOrderId: paypalOrderId
			});
			return next();
		}

		var syncResult = paypalHelper.syncOrderWithPayPal(order, getOrderResp.object);
		var success = syncResult.success && syncResult.status !== 'PENDING';

		res.setStatusCode(success ? 200 : 202);
		redirectOrRespond(res, 'paypalReturnRedirectUrl', {
			success: syncResult.success,
			status: syncResult.status || (success ? 'COMPLETED' : 'PENDING'),
			orderNo: order.orderNo,
			paypalOrderId: paypalOrderId,
			transactionId: syncResult.transactionId || '',
			message: syncResult.message || ''
		});
	} catch (e) {
		Logger.error('PayPal Return failed: {0}', e.message);
		res.setStatusCode(500);
		redirectOrRespond(res, 'paypalReturnRedirectUrl', {
			success: false,
			status: 'FAILED',
			message: e.message
		});
	}

	return next();
});

server.get('Cancel', server.middleware.https, function (req, res, next) {
	try {
		var orderNo = req.querystring.orderNo;
		var orderToken = req.querystring.orderToken;
		var order = orderNo ? paypalHelper.resolveOrder(null, orderNo, orderToken, null) : null;

		if (order) {
			paypalHelper.failPayPalOrder(order, null, 'CANCELLED');
		}

		redirectOrRespond(res, 'paypalCancelRedirectUrl', {
			success: true,
			status: 'CANCELLED',
			orderNo: order ? order.orderNo : orderNo || '',
			message: 'PayPal checkout cancelled by shopper'
		});
	} catch (e) {
		Logger.error('PayPal Cancel failed: {0}', e.message);
		res.setStatusCode(500);
		redirectOrRespond(res, 'paypalCancelRedirectUrl', {
			success: false,
			status: 'FAILED',
			message: e.message
		});
	}

	return next();
});

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
