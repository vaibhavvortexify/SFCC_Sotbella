'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var StringUtils = require('dw/util/StringUtils');

var createPaymentIntent = LocalServiceRegistry.createService('stripe.payment', {
	createRequest: function (svc, params) {
		try {
			svc.setRequestMethod('POST');
			svc.setURL(svc.configuration.credential.URL + '/payment_intents');

			var secretKey = Site.getCurrent().getCustomPreferenceValue('stripe_secret_key');

			// Auth: Basic <base64(secretKey:)>
			var authString = StringUtils.encodeBase64(secretKey + ':');
			svc.addHeader('Authorization', 'Basic ' + authString);
			svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');

			var payload = [];
			payload.push('amount=' + encodeURIComponent(params.amount));
			payload.push('currency=' + encodeURIComponent(params.currency || 'usd'));
			payload.push('automatic_payment_methods[enabled]=true');
			payload.push('customer=' + encodeURIComponent(params.customer));
			payload.push('setup_future_usage=' + encodeURIComponent(params.setup_future_usage));
			if (params.metadata) {
				Object.keys(params.metadata).forEach(function (key) {
					payload.push('metadata[' + key + ']=' + encodeURIComponent(params.metadata[key]));
				});
			}

			Logger.info('StripeCreatePaymentIntent - Payload: {0}', payload.join('&'));
			return payload.join('&');
		} catch (error) {
			Logger.error('StripeCreatePaymentIntent - Error building request: {0}', error.message);
			throw error;
		}
	},

	parseResponse: function (svc, client) {
		try {
			Logger.info('StripeCreatePaymentIntent - Response status: {0}', client.statusCode);

			var responseText = client.text;
			if (responseText && responseText.length > 2000) {
				Logger.info(
					'StripeCreatePaymentIntent - Response (truncated): {0}',
					responseText.substring(0, 2000) + '...'
				);
			} else {
				Logger.info('StripeCreatePaymentIntent - Full Response: {0}', responseText);
			}

			return JSON.parse(client.text);
		} catch (e) {
			Logger.error('StripeCreatePaymentIntent - Failed to parse response: {0}', e.message);
			return { error: true, message: 'Invalid JSON from Stripe PaymentIntent API' };
		}
	},

	filterLogMessage: function (msg) {
		// Mask secret keys and client_secret in logs
		msg = msg.replace(/sk_test_[A-Za-z0-9]+/, 'sk_test_***');
		msg = msg.replace(/sk_live_[A-Za-z0-9]+/, 'sk_live_***');
		msg = msg.replace(/"client_secret"\s*:\s*"pi_[^"]+"/, '"client_secret":"***"');
		msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i, 'Authorization: Basic ***');
		return msg;
	},

	mockCall: function () {
		return {
			id: 'pi_mock_123456789',
			object: 'payment_intent',
			amount: 1099,
			currency: 'usd',
			status: 'requires_payment_method',
			client_secret: 'pi_mock_123456789_secret_***',
		};
	},
});

var createCustomer = LocalServiceRegistry.createService('stripe.payment', {
	createRequest: function (svc, params) {
		try {
			svc.setRequestMethod('POST');
			svc.setURL(svc.configuration.credential.URL + '/customers');

			var secretKey = Site.getCurrent().getCustomPreferenceValue('stripe_secret_key');
			var authString = StringUtils.encodeBase64(secretKey + ':');

			svc.addHeader('Authorization', 'Basic ' + authString);
			svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');

			// Dynamically build payload from params
			var payload = [];

			Object.keys(params).forEach(function (key) {
				var value = params[key];

				// Skip undefined or null values
				if (value === undefined || value === null) return;

				// Handle nested metadata object
				if (key === 'metadata' && typeof value === 'object') {
					Object.keys(value).forEach(function (metaKey) {
						payload.push(
							'metadata[' + encodeURIComponent(metaKey) + ']=' + encodeURIComponent(value[metaKey])
						);
					});
				} else {
					// Add other top-level fields
					payload.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
				}
			});

			Logger.info('StripeCreateCustomer - Payload: {0}', payload.join('&'));
			return payload.join('&');
		} catch (error) {
			Logger.error('StripeCreateCustomer - Error building request: {0}', error.message);
			throw error;
		}
	},

	parseResponse: function (svc, client) {
		try {
			Logger.info('StripeCreateCustomer - Response status: {0}', client.statusCode);

			var responseText = client.text;
			if (responseText && responseText.length > 2000) {
				Logger.info(
					'StripeCreateCustomer - Response (truncated): {0}',
					responseText.substring(0, 2000) + '...'
				);
			} else {
				Logger.info('StripeCreateCustomer - Full Response: {0}', responseText);
			}

			return JSON.parse(responseText);
		} catch (e) {
			Logger.error('StripeCreateCustomer - Failed to parse response: {0}', e.message);
			return { error: true, message: 'Invalid JSON from Stripe Customer API' };
		}
	},

	filterLogMessage: function (msg) {
		msg = msg.replace(/sk_test_[A-Za-z0-9]+/, 'sk_test_***');
		msg = msg.replace(/sk_live_[A-Za-z0-9]+/, 'sk_live_***');
		msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i, 'Authorization: Basic ***');
		return msg;
	},

	mockCall: function () {
		return {
			id: 'cus_mock_123456789',
			object: 'customer',
			name: 'Mock Customer',
			email: 'mock@example.com',
		};
	},
});

var retrievePaymentIntent = LocalServiceRegistry.createService('stripe.payment', {
	createRequest: function (svc, params) {
		try {
			svc.setRequestMethod('GET');
			svc.setURL(
				svc.configuration.credential.URL + '/payment_intents/' + encodeURIComponent(params.paymentIntentId)
			);

			var secretKey = Site.getCurrent().getCustomPreferenceValue('stripe_secret_key');
			var authString = StringUtils.encodeBase64(secretKey + ':');

			svc.addHeader('Authorization', 'Basic ' + authString);

			Logger.info('StripeGetPaymentIntent - Requesting PI: {0}', params.paymentIntentId);
			return null; // GET → no body
		} catch (error) {
			Logger.error('StripeGetPaymentIntent - Error building request: {0}', error.message);
			throw error;
		}
	},

	parseResponse: function (svc, client) {
		try {
			Logger.info('StripeGetPaymentIntent - Response status: {0}', client.statusCode);

			var responseText = client.text;
			if (responseText && responseText.length > 2000) {
				Logger.info(
					'StripeGetPaymentIntent - Response (truncated): {0}',
					responseText.substring(0, 2000) + '...'
				);
			} else {
				Logger.info('StripeGetPaymentIntent - Full Response: {0}', responseText);
			}

			return JSON.parse(client.text);
		} catch (e) {
			Logger.error('StripeGetPaymentIntent - Failed to parse response: {0}', e.message);
			return { error: true, message: 'Invalid JSON from Stripe API' };
		}
	},

	filterLogMessage: function (msg) {
		msg = msg.replace(/sk_test_[A-Za-z0-9]+/, 'sk_test_***');
		msg = msg.replace(/sk_live_[A-Za-z0-9]+/, 'sk_live_***');
		msg = msg.replace(/"client_secret"\s*:\s*"pi_[^"]+"/, '"client_secret":"***"');
		msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i, 'Authorization: Basic ***');
		return msg;
	},

	mockCall: function () {
		return {
			id: 'pi_mock_123456789',
			object: 'payment_intent',
			amount: 1099,
			currency: 'usd',
			status: 'succeeded',
			client_secret: 'pi_mock_123456789_secret_***',
		};
	},
});

var cancelPaymentIntent = LocalServiceRegistry.createService('stripe.payment', {
	createRequest: function (svc, params) {
		try {
			svc.setRequestMethod('POST');
			svc.setURL(
				svc.configuration.credential.URL +
					'/payment_intents/' +
					encodeURIComponent(params.paymentIntentId) +
					'/cancel'
			);

			var secretKey = Site.getCurrent().getCustomPreferenceValue('stripe_secret_key');
			var authString = StringUtils.encodeBase64(secretKey + ':');

			svc.addHeader('Authorization', 'Basic ' + authString);
			svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');

			// optional reason param
			var payload = [];
			if (params.cancellation_reason) {
				payload.push('cancellation_reason=' + encodeURIComponent(params.cancellation_reason));
			}

			Logger.info('StripeCancelPaymentIntent - Canceling PI: {0}', params.paymentIntentId);
			if (payload.length > 0) {
				Logger.info('StripeCancelPaymentIntent - Payload: {0}', payload.join('&'));
			}

			return payload.length > 0 ? payload.join('&') : null;
		} catch (error) {
			Logger.error('StripeCancelPaymentIntent - Error building request: {0}', error.message);
			throw error;
		}
	},

	parseResponse: function (svc, client) {
		try {
			Logger.info('StripeCancelPaymentIntent - Response status: {0}', client.statusCode);

			var responseText = client.text;
			if (responseText && responseText.length > 2000) {
				Logger.info(
					'StripeCancelPaymentIntent - Response (truncated): {0}',
					responseText.substring(0, 2000) + '...'
				);
			} else {
				Logger.info('StripeCancelPaymentIntent - Full Response: {0}', responseText);
			}

			return JSON.parse(responseText);
		} catch (e) {
			Logger.error('StripeCancelPaymentIntent - Failed to parse response: {0}', e.message);
			return { error: true, message: 'Invalid JSON from Stripe Cancel PaymentIntent API' };
		}
	},

	filterLogMessage: function (msg) {
		msg = msg.replace(/sk_test_[A-Za-z0-9]+/, 'sk_test_***');
		msg = msg.replace(/sk_live_[A-Za-z0-9]+/, 'sk_live_***');
		msg = msg.replace(/"client_secret"\s*:\s*"pi_[^"]+"/, '"client_secret":"***"');
		msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i, 'Authorization: Basic ***');
		return msg;
	},

	mockCall: function () {
		return {
			id: 'pi_mock_123456789',
			object: 'payment_intent',
			status: 'canceled',
			canceled_at: Date.now() / 1000,
		};
	},
});

var createRefund = LocalServiceRegistry.createService('stripe.payment', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/refunds');

            var secretKey = Site.getCurrent().getCustomPreferenceValue('stripe_secret_key');
            var authString = StringUtils.encodeBase64(secretKey + ':');

            svc.addHeader('Authorization', 'Basic ' + authString);
            svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');

            // Dynamically build payload from params to support charge, payment_intent, amount, etc.
            var payload = [];

            Object.keys(params).forEach(function (key) {
                var value = params[key];

                // Skip undefined or null values
                if (value === undefined || value === null) return;

                // Handle nested metadata object
                if (key === 'metadata' && typeof value === 'object') {
                    Object.keys(value).forEach(function (metaKey) {
                        payload.push(
                            'metadata[' + encodeURIComponent(metaKey) + ']=' + encodeURIComponent(value[metaKey])
                        );
                    });
                } else {
                    // Add other top-level fields (charge, payment_intent, amount, reason, etc.)
                    payload.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
                }
            });

            Logger.info('StripeCreateRefund - Payload: {0}', payload.join('&'));
            return payload.join('&');
        } catch (error) {
            Logger.error('StripeCreateRefund - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('StripeCreateRefund - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info(
                    'StripeCreateRefund - Response (truncated): {0}',
                    responseText.substring(0, 2000) + '...'
                );
            } else {
                Logger.info('StripeCreateRefund - Full Response: {0}', responseText);
            }

            return JSON.parse(responseText);
        } catch (e) {
            Logger.error('StripeCreateRefund - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Stripe Refund API' };
        }
    },

    filterLogMessage: function (msg) {
        msg = msg.replace(/sk_test_[A-Za-z0-9]+/, 'sk_test_***');
        msg = msg.replace(/sk_live_[A-Za-z0-9]+/, 'sk_live_***');
        // Mask generic ID patterns in logs if necessary, adhering to existing style
        msg = msg.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i, 'Authorization: Basic ***');
        return msg;
    },

    mockCall: function () {
        return {
            id: 're_mock_123456789',
            object: 'refund',
            amount: 1099,
            currency: 'usd',
            status: 'succeeded',
            charge: 'ch_mock_123456789'
        };
    },
});

module.exports = {
	createPaymentIntent: createPaymentIntent,
	createCustomer: createCustomer,
	retrievePaymentIntent: retrievePaymentIntent,
	cancelPaymentIntent: cancelPaymentIntent,
	createRefund: createRefund
};
