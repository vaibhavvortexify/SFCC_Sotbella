'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Transaction = require('dw/system/Transaction');
var Site = require('dw/system/Site');
var Money = require('dw/value/Money');
var walletHelpers = require('*/cartridge/scripts/helpers/walletHelper');
var HookMgr = require('dw/system/HookMgr');
/**
 * Executes after a payment instrument is successfully added or created via a POST request.
 * This hook is used to perform any necessary post-processing or data enrichment.
 *
 * @param {dw.order.Basket} basket - The basket object that the payment instrument was added to.
 * @param {Object} paymentInstrument - The parsed JSON object of the request body, representing the payment instrument data.
 */
exports.beforePOST = function (basket, paymentInstrument) {
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}
	if (!Site.getCurrent().getCustomPreferenceValue('guestCheckout'))
		if (!request.session.customerAuthenticated)
			return new Status(
				Status.ERROR,
				'CUSTOMER_NOT_AUTHENTICATED',
				'Authentication is required before a shipment can be added to the basket.'
			);
	var collections = require('*/cartridge/scripts/util/collections');
	var grossPrice = basket.getTotalGrossPrice();
	var netPrice = basket.getTotalNetPrice();
	if (!basket || basket.productLineItems.empty)
		return new Status(Status.ERROR, 'BASKET_EMPTY', 'Cannot create an order from an empty basket.');
	if (basket.defaultShipment.shippingAddress === null)
		return new Status(Status.ERROR, 'MISSING_SHIPPING_ADDRESS', 'The basket is missing a shipping address.');
	if (basket.billingAddress === null)
		return new Status(Status.ERROR, 'MISSING_BILLING_ADDRESS', 'The basket is missing a billing address.');
	if (grossPrice < paymentInstrument.amount)
		return new Status(
			Status.ERROR,
			'PAYMENT_AMOUNT_INVALID',
			`Payment instrument amount is greater than the basket's total gross price.`
		);
	if (!grossPrice || grossPrice.value <= 0 || !netPrice || netPrice.value <= 0)
		return new Status(Status.ERROR, 'MISSING_PRICES', 'The basket is missing totalGrossPrice or totalNetPrice.');
	if (paymentInstrument.paymentMethodId === 'WALLET') {
		if (paymentInstrument.amount < 1){
			return new Status(Status.ERROR, 'WALLET_AMOUNT_ZERO', 'WALLET transaction amount cannot be zero.');
		}
		if (!customer || !customer.profile || !customer.profile.email) {
            return new Status(Status.ERROR, 'WALLET_NO_EMAIL', 'Cannot verify wallet: Customer email missing or not authenticated.');
        }
		var customerEmail = customer.profile.email;
		var balanceResponse = walletHelpers.getCustomerWalletBalance(customerEmail);
        var walletBalance = 0;
		if (balanceResponse.success && balanceResponse.data) {
            walletBalance = balanceResponse.data.balance;
        } else {
            var errorMsg = balanceResponse.error || 'Service Unavailable';
            return new Status(Status.ERROR, 'WALLET_SERVICE_ERROR', 'Unable to fetch wallet balance: ' + errorMsg);
        }
		if (paymentInstrument.amount > walletBalance){
			return new Status(Status.ERROR, 'WALLET_INSUFFICIENT_BALANCE', 'WALLET has insufficient balance.');
		}
		
		Transaction.wrap(function () {
			var paymentInstruments = basket.getPaymentInstruments();
			collections.forEach(paymentInstruments, function (instrument) {
				if (instrument.getPaymentMethod() === 'WALLET') {
					basket.removePaymentInstrument(instrument);
				}
			});
		});
	}
	basket.updateTotals();
    HookMgr.callHook('dw.order.calculate', 'calculate', basket);
};

/**
 * Executes after a payment instrument is successfully added or created via a POST request.
 * This hook is used to perform any necessary post-processing or data enrichment.
 *
 * @param {dw.order.Basket} basket - The basket object that the payment instrument was added to.
 * @param {Object} paymentInstrument - The parsed JSON object of the request body, representing the payment instrument data.
 */
exports.afterPOST = function (basket, paymentInstrument) {
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}
	var basketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
	var collections = require('*/cartridge/scripts/util/collections');
	Transaction.wrap(function () {
		basketCalculationHelpers.calculateTotals(basket);
	});
	if (basket.paymentInstruments.empty)
		return new Status(Status.ERROR, 'MISSING_PAYMENT', 'The basket is missing a payment instrument.');
	try {
		Transaction.wrap(function () {
			var walletAmount = new Money(0, basket.getCurrencyCode());
			var paymentInstruments = basket.getPaymentInstruments();
			collections.forEach(paymentInstruments, function (instrument) {
				if (instrument.getPaymentMethod() === 'WALLET') {
					walletAmount = walletAmount.add(instrument.getPaymentTransaction().getAmount());
				} else {
					basket.removePaymentInstrument(instrument);
				}
			});
			var remainingAmount = basket.getTotalGrossPrice().subtract(walletAmount);
			if (paymentInstrument.paymentMethodId !== 'WALLET') {
				var newInstrument;
				if (remainingAmount.value > 0) {
					newInstrument = basket.createPaymentInstrument(paymentInstrument.paymentMethodId, remainingAmount);
				} else {
					newInstrument = basket.createPaymentInstrument(paymentInstrument.paymentMethodId, basket.getTotalGrossPrice());
				}
				
				basketCalculationHelpers.calculateTotals(basket);
				var discountedAmount = basket.getTotalGrossPrice().subtract(walletAmount);
    
				if (discountedAmount.value >= 0) {
					newInstrument.getPaymentTransaction().setAmount(discountedAmount);
				}
			}
		});
	} catch (e) {
		Logger.error('Full stack trace: {0}', e.stack);
		Logger.error('Error Message: {0}', e.message);
		return new Status(Status.ERROR, 'INSTRUMENTATION_UPDATION_FAILED', e.message);
	}
	basket.updateTotals();
    HookMgr.callHook('dw.order.calculate', 'calculate', basket);

	return new Status(Status.OK);
};
