'use strict';

var Logger = require('dw/system/Logger').getLogger('PayPal', 'PayPal');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var PaymentMgr = require('dw/order/PaymentMgr');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var Calendar = require('dw/util/Calendar');
var ArrayList = require('dw/util/ArrayList');

var paypalService = require('*/cartridge/services/paypalService');
var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers');
var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper');
var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService');
var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;

function getPayPalPaymentInstrument(order) {
	var paymentInstruments = order.getPaymentInstruments();
	for (var i = 0; i < paymentInstruments.length; i++) {
		if (paymentInstruments[i].getPaymentMethod() === 'PAYPAL') {
			return paymentInstruments[i];
		}
	}
	return null;
}

function getPayPalLink(paypalOrder, rel) {
	var links = paypalOrder && paypalOrder.links ? paypalOrder.links : [];
	for (var i = 0; i < links.length; i++) {
		if (links[i] && links[i].rel === rel) {
			return links[i].href;
		}
	}
	return null;
}

function getPayPalCapture(paypalOrder) {
	if (!paypalOrder || !paypalOrder.purchase_units || !paypalOrder.purchase_units.length) {
		return null;
	}

	for (var i = 0; i < paypalOrder.purchase_units.length; i++) {
		var purchaseUnit = paypalOrder.purchase_units[i];
		var captures = purchaseUnit && purchaseUnit.payments ? purchaseUnit.payments.captures : null;
		if (captures && captures.length) {
			return captures[0];
		}
	}

	return null;
}

function getPayPalCustomId(paypalOrder) {
	if (paypalOrder && paypalOrder.custom_id) {
		return paypalOrder.custom_id;
	}

	if (!paypalOrder || !paypalOrder.purchase_units || !paypalOrder.purchase_units.length) {
		return null;
	}

	for (var i = 0; i < paypalOrder.purchase_units.length; i++) {
		if (paypalOrder.purchase_units[i] && paypalOrder.purchase_units[i].custom_id) {
			return paypalOrder.purchase_units[i].custom_id;
		}
	}

	return null;
}

function getPayPalInvoiceId(paypalOrder) {
	if (paypalOrder && paypalOrder.invoice_id) {
		return paypalOrder.invoice_id;
	}

	if (!paypalOrder || !paypalOrder.purchase_units || !paypalOrder.purchase_units.length) {
		return null;
	}

	for (var i = 0; i < paypalOrder.purchase_units.length; i++) {
		if (paypalOrder.purchase_units[i] && paypalOrder.purchase_units[i].invoice_id) {
			return paypalOrder.purchase_units[i].invoice_id;
		}
	}

	return null;
}

function buildPayPalRequestId(orderNo, action) {
	return [orderNo, action, String(new Date().getTime())].join('-');
}

function parseOrderReference(customId) {
	if (!customId) {
		return null;
	}

	var parts = String(customId).split('|');
	return {
		orderNo: parts[0] || null,
		orderToken: parts[1] || null
	};
}

function buildShippingAddress(order) {
	var shipment = order.getDefaultShipment ? order.getDefaultShipment() : null;
	var shippingAddress = shipment ? shipment.getShippingAddress() : null;

	if (!shippingAddress) {
		return null;
	}

	var addressLine1 = shippingAddress.address1 || shippingAddress.address1 === '' ? shippingAddress.address1 : null;
	var addressLine2 = shippingAddress.address2 || shippingAddress.address2 === '' ? shippingAddress.address2 : null;
	var adminArea2 = shippingAddress.city || null;
	var adminArea1 = shippingAddress.stateCode || shippingAddress.stateCode === '' ? shippingAddress.stateCode : null;
	var postalCode = shippingAddress.postalCode || null;
	var countryCode = shippingAddress.countryCode
		? shippingAddress.countryCode.value || shippingAddress.countryCode.valueOf() || String(shippingAddress.countryCode)
		: null;

	if (!addressLine1 || !adminArea2 || !postalCode || !countryCode) {
		return null;
	}

	return {
		name: {
			full_name: [shippingAddress.firstName || '', shippingAddress.lastName || ''].join(' ').replace(/\s+/g, ' ').trim()
		},
		address: {
			address_line_1: addressLine1,
			address_line_2: addressLine2 || undefined,
			admin_area_2: adminArea2,
			admin_area_1: adminArea1 || undefined,
			postal_code: postalCode,
			country_code: countryCode
		}
	};
}

function buildCreateOrderPayload(order) {
	var site = Site.getCurrent();
	var brandName = site.getCustomPreferenceValue('paypalBrandName') || site.getName() || 'Sotbella';
	var customId = order.orderNo + '|' + order.orderToken;
	var shipping = buildShippingAddress(order);
	var purchaseUnit = {
		reference_id: order.orderNo,
		invoice_id: order.orderNo,
		custom_id: customId,
		description: 'Order ' + order.orderNo,
		amount: {
			currency_code: order.getCurrencyCode(),
			value: order.totalGrossPrice.value.toFixed(2)
		}
	};

	if (shipping) {
		purchaseUnit.shipping = shipping;
	}

	return {
		intent: 'CAPTURE',
		purchase_units: [purchaseUnit],
		payment_source: {
			paypal: {
				experience_context: {
					brand_name: String(brandName),
					user_action: 'PAY_NOW',
					shipping_preference: shipping ? 'SET_PROVIDED_ADDRESS' : 'GET_FROM_FILE',
					return_url: URLUtils.https('Paypal-Return', 'orderNo', order.orderNo, 'orderToken', order.orderToken).toString(),
					cancel_url: URLUtils.https('Paypal-Cancel', 'orderNo', order.orderNo, 'orderToken', order.orderToken).toString()
				}
			}
		}
	};
}

function updatePayPalPaymentInstrument(order, paypalOrder) {
	var paymentInstrument = getPayPalPaymentInstrument(order);
	var capture = getPayPalCapture(paypalOrder);
	var payer = paypalOrder ? paypalOrder.payer : null;

	if (!paymentInstrument) {
		throw new Error('PayPal payment instrument not found for order ' + order.orderNo);
	}

	var paymentTransaction = paymentInstrument.getPaymentTransaction();
	var paymentMethod = PaymentMgr.getPaymentMethod('PAYPAL');
	if (paymentMethod && paymentMethod.getPaymentProcessor()) {
		paymentTransaction.setPaymentProcessor(paymentMethod.getPaymentProcessor());
	}

	if (capture && capture.id) {
		paymentTransaction.setTransactionID(capture.id);
		paymentInstrument.custom.paypal_capture_id = capture.id;
	}

	paymentInstrument.custom.paypal_order_id = paypalOrder && paypalOrder.id ? paypalOrder.id : paymentInstrument.custom.paypal_order_id;
	paymentInstrument.custom.paypal_order_status = paypalOrder && paypalOrder.status ? paypalOrder.status : paymentInstrument.custom.paypal_order_status;
	paymentInstrument.custom.paypal_approve_url =
		getPayPalLink(paypalOrder, 'payer-action') ||
		getPayPalLink(paypalOrder, 'approve') ||
		paymentInstrument.custom.paypal_approve_url;
	paymentInstrument.custom.paypal_capture_status =
		capture && capture.status ? capture.status : paymentInstrument.custom.paypal_capture_status;
	paymentInstrument.custom.paypal_payer_id = payer && payer.payer_id ? payer.payer_id : paymentInstrument.custom.paypal_payer_id;
	paymentInstrument.custom.paypal_payer_email =
		payer && payer.email_address ? payer.email_address : paymentInstrument.custom.paypal_payer_email;
}

function markPayPalPending(order, paypalOrder) {
	Transaction.wrap(function () {
		updatePayPalPaymentInstrument(order, paypalOrder);
	});

	return {
		success: true,
		status: 'PENDING',
		message: 'PayPal payment is pending'
	};
}

function placePaidOrder(order) {
	var handlePaymentsResult = paymentHelpers.handlePayments(order, null);
	if (handlePaymentsResult.error) {
		order.custom.orderStatus = 8;
		OrderMgr.failOrder(order, true);
		throw new Error('Payment handling failed for order ' + order.orderNo);
	}

	order.custom.orderStatus = 0;
	var placeOrderStatus = OrderMgr.placeOrder(order);
	if (placeOrderStatus.isError()) {
		order.custom.orderStatus = 8;
		OrderMgr.failOrder(order, true);
		throw new Error('Order placement failed for order ' + order.orderNo);
	}

	order.setPaymentStatus(Order.PAYMENT_STATUS_PAID);
	order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);

	paymentHelpers.updateTotalOrdersAndSpent(order);
	sendRefersionDataHelper.sendRefersionData(order);

	var createOrderRes = callCreateSaleOrder(order, function (placedOrder, token) {
		return UnicommerceCreatOrderService.createSaleOrder(placedOrder, token);
	});

	var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
	emailHelper.sendOrderConfirmMail(order);
	if (createOrderRes.object && createOrderRes.object.successful === false) {
		Logger.error('Unicommerce: Failed to create order for PayPal order {0}', order.orderNo);
	} else {
		Logger.info('Unicommerce: Successfully created order for PayPal order {0}.', order.orderNo);
		order.exportStatus = 1;
		order.custom.UpdateFlowFlag = true;
	}
}

function handlePayPalPayment(order, paymentInstrument) {
	if (!order.totalGrossPrice || order.totalGrossPrice.value <= 0) {
		throw new Error('PayPal: Invalid order total.');
	}

	var createResp = paypalService.createOrder({
		requestId: buildPayPalRequestId(order.orderNo, 'create'),
		body: buildCreateOrderPayload(order)
	});

	if (!createResp.ok || !createResp.object || !createResp.object.id) {
		throw new Error('PayPal: Failed to create PayPal order.');
	}

	var approveUrl = getPayPalLink(createResp.object, 'payer-action') || getPayPalLink(createResp.object, 'approve');
	if (!approveUrl) {
		throw new Error('PayPal: Missing approval URL in create order response.');
	}

	Transaction.wrap(function () {
		paymentInstrument.custom.paypal_order_id = createResp.object.id;
		paymentInstrument.custom.paypal_order_status = createResp.object.status || 'CREATED';
		paymentInstrument.custom.paypal_approve_url = approveUrl;
		paymentInstrument.custom.paypal_request_id = buildPayPalRequestId(order.orderNo, 'approval');
		paymentInstrument.custom.paypal_capture_id = '';
		paymentInstrument.custom.paypal_capture_status = '';
		paymentInstrument.custom.paypal_payer_id = '';
		paymentInstrument.custom.paypal_payer_email = '';
	});

	Logger.info('PayPal: Created order {0} for SFCC order {1}', createResp.object.id, order.orderNo);
}

function finalizePayPalOrder(order, paypalOrder) {
	var capture = getPayPalCapture(paypalOrder);
	var captureStatus = capture && capture.status ? capture.status : paypalOrder.status;

	if (!capture || (captureStatus !== 'COMPLETED' && captureStatus !== 'PENDING')) {
		return {
			success: false,
			message: 'PayPal capture is not ready for finalization.'
		};
	}

	if (captureStatus === 'PENDING') {
		return markPayPalPending(order, paypalOrder);
	}

	try {
		Transaction.wrap(function () {
			updatePayPalPaymentInstrument(order, paypalOrder);

			if (order.status.value !== Order.ORDER_STATUS_CREATED) {
				order.setPaymentStatus(Order.PAYMENT_STATUS_PAID);
				order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);
				return;
			}

			var walletResult = paymentHelpers.processWalletPayment(order);
			if (!walletResult.success) {
				order.custom.orderStatus = 8;
				OrderMgr.failOrder(order, true);
				throw new Error('Wallet Deduction Failed: ' + walletResult.error);
			}

			placePaidOrder(order);
		});

		return {
			success: true,
			status: 'COMPLETED',
			transactionId: capture.id
		};
	} catch (e) {
		Logger.error('PayPal finalization failed for order {0}: {1}', order.orderNo, e.message);
		return {
			success: false,
			message: e.message
		};
	}
}

function failPayPalOrder(order, paypalOrder, failureReason) {
	try {
		Transaction.wrap(function () {
			if (paypalOrder) {
				updatePayPalPaymentInstrument(order, paypalOrder);
			} else {
				var paymentInstrument = getPayPalPaymentInstrument(order);
				if (paymentInstrument) {
					paymentInstrument.custom.paypal_order_status = failureReason || paymentInstrument.custom.paypal_order_status;
					paymentInstrument.custom.paypal_capture_status = failureReason || paymentInstrument.custom.paypal_capture_status;
				}
			}

			if (order.status.value === Order.ORDER_STATUS_CREATED) {
				order.custom.orderStatus = 8;
				OrderMgr.failOrder(order, true);
			}
		});

		return { success: true };
	} catch (e) {
		Logger.error('PayPal fail flow failed for order {0}: {1}', order.orderNo, e.message);
		return {
			success: false,
			message: e.message
		};
	}
}

function findOrderByPayPalOrderId(paypalOrderId) {
	if (!paypalOrderId) {
		return null;
	}

	var cal = new Calendar(new Date());
	cal.add(Calendar.DAY_OF_YEAR, -7);
	var searchStart = cal.getTime();
	var orderIterator = OrderMgr.searchOrders(
		'creationDate >= {0} AND (status = {1} OR status = {2} OR status = {3})',
		'creationDate desc',
		searchStart,
		Order.ORDER_STATUS_CREATED,
		Order.ORDER_STATUS_NEW,
		Order.ORDER_STATUS_OPEN
	);

	try {
		while (orderIterator.hasNext()) {
			var order = orderIterator.next();
			var paymentInstrument = getPayPalPaymentInstrument(order);
			if (paymentInstrument && paymentInstrument.custom.paypal_order_id === paypalOrderId) {
				return order;
			}
		}
	} finally {
		if (orderIterator) {
			orderIterator.close();
		}
	}

	return null;
}

function resolveOrder(paypalOrder, orderNo, orderToken, paypalOrderId) {
	if (orderNo) {
		var directOrder = orderToken ? OrderMgr.getOrder(orderNo, orderToken) : OrderMgr.getOrder(orderNo);
		if (directOrder) {
			return directOrder;
		}
	}

	var reference = parseOrderReference(getPayPalCustomId(paypalOrder));
	if (reference && reference.orderNo) {
		var referencedOrder = reference.orderToken
			? OrderMgr.getOrder(reference.orderNo, reference.orderToken)
			: OrderMgr.getOrder(reference.orderNo);
		if (referencedOrder) {
			return referencedOrder;
		}
	}

	var invoiceId = getPayPalInvoiceId(paypalOrder);
	if (invoiceId) {
		var invoiceOrder = OrderMgr.getOrder(invoiceId);
		if (invoiceOrder) {
			return invoiceOrder;
		}
	}

	return findOrderByPayPalOrderId(paypalOrderId || (paypalOrder && paypalOrder.id));
}

function syncOrderWithPayPal(order, paypalOrder) {
	var capture = getPayPalCapture(paypalOrder);
	var status = paypalOrder && paypalOrder.status ? paypalOrder.status : null;
	var captureStatus = capture && capture.status ? capture.status : null;

	if (captureStatus === 'COMPLETED' || status === 'COMPLETED') {
		return finalizePayPalOrder(order, paypalOrder);
	}

	if (captureStatus === 'PENDING') {
		return markPayPalPending(order, paypalOrder);
	}

	if (status === 'APPROVED') {
		var captureResp = paypalService.captureOrder({
			paypalOrderId: paypalOrder.id,
			requestId: buildPayPalRequestId(order.orderNo, 'capture')
		});

		if (!captureResp.ok || !captureResp.object || !captureResp.object.id) {
			return {
				success: false,
				message: 'PayPal capture call failed.'
			};
		}

		return finalizePayPalOrder(order, captureResp.object);
	}

	if (status === 'VOIDED' || status === 'CANCELLED' || captureStatus === 'DENIED') {
		return failPayPalOrder(order, paypalOrder, captureStatus || status);
	}

	return {
		success: true,
		status: status || captureStatus || 'CREATED',
		message: 'PayPal order is still awaiting shopper action.'
	};
}

function verifyWebhook(headers, rawBody, webhookEvent) {
	var verificationBody = {
		auth_algo: headers.authAlgo,
		cert_url: headers.certUrl,
		transmission_id: headers.transmissionId,
		transmission_sig: headers.transmissionSig,
		transmission_time: headers.transmissionTime,
		webhook_event: webhookEvent
	};

	var verifyResp = paypalService.verifyWebhookSignature({
		body: verificationBody
	});

	return verifyResp.ok &&
		verifyResp.object &&
		verifyResp.object.verification_status &&
		verifyResp.object.verification_status === 'SUCCESS';
}

function handlePayPalRefund(order, amount, paymentInstrument) {
	var targetInstrument = paymentInstrument || getPayPalPaymentInstrument(order);
	if (!targetInstrument) {
		return {
			success: false,
			method: 'PAYPAL',
			error: 'PayPal payment instrument not found'
		};
	}

	var captureId = targetInstrument.custom.paypal_capture_id || targetInstrument.getPaymentTransaction().getTransactionID();
	if (!captureId) {
		return {
			success: false,
			method: 'PAYPAL',
			error: 'PayPal capture ID not found'
		};
	}

	var refundResp = paypalService.refundCapture({
		captureId: captureId,
		requestId: buildPayPalRequestId(order.orderNo, 'refund'),
		body: {
			amount: {
				value: amount.toFixed(2),
				currency_code: order.getCurrencyCode()
			},
			note_to_payer: 'Refund for order ' + order.orderNo
		}
	});

	if (!refundResp.ok || !refundResp.object || !refundResp.object.id) {
		return {
			success: false,
			method: 'PAYPAL',
			error: refundResp.errorMessage || 'PayPal refund failed'
		};
	}

	Transaction.wrap(function () {
		var refundData = {
			id: refundResp.object.id,
			amount: amount,
			date: refundResp.object.create_time || new Date().toISOString(),
			status: refundResp.object.status || 'COMPLETED'
		};
		var paymentTransaction = targetInstrument.getPaymentTransaction();
		var currentRefunds = paymentTransaction.custom.refunds || [];
		var refundList = new ArrayList(currentRefunds);
		refundList.add(JSON.stringify(refundData));
		paymentTransaction.custom.refunds = refundList;
	});

	return {
		success: true,
		method: 'PAYPAL',
		amount: amount,
		transactionId: refundResp.object.id,
		rawResponse: refundResp.object
	};
}

module.exports = {
	buildPayPalRequestId: buildPayPalRequestId,
	getPayPalCapture: getPayPalCapture,
	getPayPalPaymentInstrument: getPayPalPaymentInstrument,
	handlePayPalPayment: handlePayPalPayment,
	finalizePayPalOrder: finalizePayPalOrder,
	failPayPalOrder: failPayPalOrder,
	resolveOrder: resolveOrder,
	findOrderByPayPalOrderId: findOrderByPayPalOrderId,
	syncOrderWithPayPal: syncOrderWithPayPal,
	verifyWebhook: verifyWebhook,
	handlePayPalRefund: handlePayPalRefund
};
