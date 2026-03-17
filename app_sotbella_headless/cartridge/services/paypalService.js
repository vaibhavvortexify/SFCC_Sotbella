'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var StringUtils = require('dw/util/StringUtils');

function getClientId() {
	return Site.getCurrent().getCustomPreferenceValue('paypalClientId');
}

function getClientSecret() {
	return Site.getCurrent().getCustomPreferenceValue('paypalClientSecret');
}

function getWebhookId() {
	return Site.getCurrent().getCustomPreferenceValue('paypalWebhookId');
}

function getPartnerAttributionId() {
	return Site.getCurrent().getCustomPreferenceValue('paypalPartnerAttributionId');
}

function getBasicAuthorization() {
	var clientId = getClientId();
	var clientSecret = getClientSecret();

	if (!clientId || !clientSecret) {
		throw new Error('Missing PayPal client credentials.');
	}

	return 'Basic ' + StringUtils.encodeBase64(clientId + ':' + clientSecret);
}

function addBearerHeaders(svc, params) {
	svc.addHeader('Authorization', 'Bearer ' + params.accessToken);
	svc.addHeader('Content-Type', 'application/json');

	if (params.requestId) {
		svc.addHeader('PayPal-Request-Id', params.requestId);
	}

	var partnerAttributionId = getPartnerAttributionId();
	if (partnerAttributionId) {
		svc.addHeader('PayPal-Partner-Attribution-Id', partnerAttributionId);
	}
}

function parseJSONResponse(logPrefix, client) {
	try {
		Logger.info('{0} - Response status: {1}', logPrefix, client.statusCode);

		var responseText = client.text;
		if (responseText && responseText.length > 2000) {
			Logger.info('{0} - Response (truncated): {1}', logPrefix, responseText.substring(0, 2000) + '...');
		} else {
			Logger.info('{0} - Full Response: {1}', logPrefix, responseText);
		}

		return responseText ? JSON.parse(responseText) : {};
	} catch (e) {
		Logger.error('{0} - Failed to parse response: {1}', logPrefix, e.message);
		return { error: true, message: 'Invalid JSON from PayPal API' };
	}
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filterLogMessage(msg) {
	msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi, 'Authorization: Basic ***');
	msg = msg.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Authorization: Bearer ***');

	var clientId = getClientId();
	var clientSecret = getClientSecret();

	if (clientId) {
		msg = msg.replace(new RegExp(escapeRegExp(clientId), 'g'), '***');
	}
	if (clientSecret) {
		msg = msg.replace(new RegExp(escapeRegExp(clientSecret), 'g'), '***');
	}

	return msg;
}

var accessTokenService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc) {
		svc.setRequestMethod('POST');
		svc.setURL(svc.configuration.credential.URL + '/v1/oauth2/token');
		svc.addHeader('Authorization', getBasicAuthorization());
		svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');
		return 'grant_type=client_credentials';
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalAccessToken', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			access_token: 'mock_paypal_access_token',
			token_type: 'Bearer',
			expires_in: 3600
		};
	}
});

var createOrderService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('POST');
		svc.setURL(svc.configuration.credential.URL + '/v2/checkout/orders');
		addBearerHeaders(svc, params);
		svc.addHeader('Prefer', 'return=representation');
		Logger.info('PayPalCreateOrder - Payload: {0}', JSON.stringify(params.body));
		return JSON.stringify(params.body || {});
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalCreateOrder', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			id: 'PAYPAL-ORDER-MOCK',
			status: 'CREATED',
			links: [
				{
					rel: 'payer-action',
					href: 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-MOCK'
				}
			]
		};
	}
});

var getOrderService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('GET');
		svc.setURL(svc.configuration.credential.URL + '/v2/checkout/orders/' + encodeURIComponent(params.paypalOrderId));
		addBearerHeaders(svc, params);
		return null;
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalGetOrder', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			id: 'PAYPAL-ORDER-MOCK',
			status: 'APPROVED'
		};
	}
});

var captureOrderService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('POST');
		svc.setURL(
			svc.configuration.credential.URL +
				'/v2/checkout/orders/' +
				encodeURIComponent(params.paypalOrderId) +
				'/capture'
		);
		addBearerHeaders(svc, params);
		svc.addHeader('Prefer', 'return=representation');
		Logger.info('PayPalCaptureOrder - Payload: {0}', JSON.stringify(params.body || {}));
		return JSON.stringify(params.body || {});
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalCaptureOrder', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			id: 'PAYPAL-ORDER-MOCK',
			status: 'COMPLETED',
			purchase_units: [
				{
					payments: {
						captures: [
							{
								id: 'CAPTURE-MOCK',
								status: 'COMPLETED'
							}
						]
					}
				}
			]
		};
	}
});

var refundCaptureService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('POST');
		svc.setURL(
			svc.configuration.credential.URL +
				'/v2/payments/captures/' +
				encodeURIComponent(params.captureId) +
				'/refund'
		);
		addBearerHeaders(svc, params);
		svc.addHeader('Prefer', 'return=representation');
		Logger.info('PayPalRefundCapture - Payload: {0}', JSON.stringify(params.body || {}));
		return JSON.stringify(params.body || {});
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalRefundCapture', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			id: 'REFUND-MOCK',
			status: 'COMPLETED'
		};
	}
});

var verifyWebhookSignatureService = LocalServiceRegistry.createService('paypal.http', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('POST');
		svc.setURL(svc.configuration.credential.URL + '/v1/notifications/verify-webhook-signature');
		addBearerHeaders(svc, params);
		Logger.info('PayPalVerifyWebhook - Payload: {0}', JSON.stringify(params.body || {}));
		return JSON.stringify(params.body || {});
	},
	parseResponse: function (svc, client) {
		return parseJSONResponse('PayPalVerifyWebhook', client);
	},
	filterLogMessage: filterLogMessage,
	mockCall: function () {
		return {
			verification_status: 'SUCCESS'
		};
	}
});

function getAccessToken() {
	return accessTokenService.call();
}

function callWithAccessToken(service, params) {
	var tokenResult = getAccessToken();

	if (!tokenResult.ok || !tokenResult.object || !tokenResult.object.access_token) {
		return tokenResult;
	}

	params = params || {};
	params.accessToken = tokenResult.object.access_token;

	return service.call(params);
}

function createOrder(params) {
	return callWithAccessToken(createOrderService, params);
}

function getOrder(params) {
	return callWithAccessToken(getOrderService, params);
}

function captureOrder(params) {
	return callWithAccessToken(captureOrderService, params);
}

function refundCapture(params) {
	return callWithAccessToken(refundCaptureService, params);
}

function verifyWebhookSignature(params) {
	params = params || {};
	params.body = params.body || {};

	if (!params.body.webhook_id) {
		params.body.webhook_id = getWebhookId();
	}

	return callWithAccessToken(verifyWebhookSignatureService, params);
}

module.exports = {
	getAccessToken: getAccessToken,
	createOrder: createOrder,
	getOrder: getOrder,
	captureOrder: captureOrder,
	refundCapture: refundCapture,
	verifyWebhookSignature: verifyWebhookSignature
};
