'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var OrderMgr = require('dw/order/OrderMgr');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');
var GetUpdateInventoryHelper = require('*/cartridge/scripts/helpers/GetUpdateInventoryHelper');
var walletHelpers = require('*/cartridge/scripts/helpers/walletHelper');


/**
 * Executes after a payment instrument is successfully added or created via a POST request.
 * This hook is used to perform any necessary post-processing or data enrichment.
 *
 * @param {dw.order.Basket} basket - The basket object that the payment instrument was added to.
 */

exports.beforePOST = function (basket) {
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
	var paymentInstruments = basket.getPaymentInstruments();
	var totalInstrumentsAmt = 0;
	var walletPaymentInstrument = null;

	collections.forEach(paymentInstruments, function (instrument) {
		totalInstrumentsAmt += instrument.getPaymentTransaction().getAmount().value;
		if (instrument.getPaymentMethod() === 'WALLET') {
			walletPaymentInstrument = instrument;
		}
	});
	// ******* WALLET BALANCE CHECK *******
	if (walletPaymentInstrument) {
		try {
			// 1. Verify Customer Authentication
			if (!customer.authenticated || !customer.profile || !customer.profile.email) {
				return new Status(Status.ERROR, 'WALLET_AUTH_REQUIRED', 'Customer must be authenticated to use Wallet.');
			}
			var email = customer.profile.email;
			var walletAmount = walletPaymentInstrument.getPaymentTransaction().getAmount().value;
			var balanceResult = walletHelpers.getCustomerWalletBalance(email);
			if (!balanceResult.success) {
				Logger.error('Wallet Balance Check Failed: {0}', balanceResult.error);
				return new Status(Status.ERROR, 'WALLET_SERVICE_ERROR', 'Unable to verify wallet balance. Please try again.');
			}
			var currentBalance = balanceResult.data.balance
			if (currentBalance < walletAmount) {
				return new Status(
					Status.ERROR,
					'WALLET_INSUFFICIENT_FUNDS',
					'Insufficient wallet balance. Available: ' + currentBalance + ', Required: ' + walletAmount
				);
			}
		} catch (error) {
			Logger.error('Exception in Wallet Check: {0}', e.message);
			return new Status(Status.ERROR, 'WALLET_SYSTEM_ERROR', 'System error verifying wallet balance.');
		}
	}
	if (basket.getTotalGrossPrice().value !== totalInstrumentsAmt) {
		return new Status(
			Status.ERROR,
			'PAYMENT_AMOUNT_MISMATCH',
			`The total payment amount does not match the basket's required total gross price.`
		);
	}
	// ******* WALLET BALANCE CHECK *******


	// ******* Syncing inventory for all basket items with Unicommerce *******

	try {
		var BasketItemsQuantityMap = GetUpdateInventoryHelper.getBaksetItemsQuantityMap(basket, []);

		var snapshots = GetUpdateInventoryHelper.getSnapshots(basket, []);
		if (snapshots.error) {
			Logger.error('Error fetching inventory snapshots: {0}', snapshots.error);
			return new Status(Status.ERROR, snapshots.error);
		}
		var skuMap = {};
		
		var result = GetUpdateInventoryHelper.updateInventoryForBasket(snapshots);

		snapshots.forEach(function (item) {
			var sku = item.itemTypeSKU;
			var availableQty = item.inventory || 0;

			skuMap[sku] = availableQty;
		});

		var plis = basket.productLineItems;
		for (var i = 0; i < plis.length; i++) {
			var pli = plis[i];
			var sku = pli.productID;
			var availableQty = skuMap[sku] || 0;

			if (availableQty < BasketItemsQuantityMap[sku]) {
				Logger.info('Product {0} has insufficient stock. Available: {1}, Requested: {2}. Preventing Order Creation.', sku, availableQty, BasketItemsQuantityMap[sku]);
				throw new Error('Product ' + sku + ' has insufficient stock.');
			}
		}

		Transaction.wrap(function () {
			if(true || customer.profile.email){
				//basket.customerEmail = customer.profile.email;
				basket.customerEmail = 'vaibhav@test.com';
			}
		})
		Logger.info('Inventory updated BEFORE ADD. Updated SKUs = {0}, Failed SKUs = {1}', JSON.stringify(result.updated), JSON.stringify(result.failed));
	} catch (e) {
		Logger.error('beforePOST error: {0}', e.message);
		return new Status(Status.ERROR, e.message);
	}
	// **********************************************************************
	return new Status(Status.OK);
};

/**
 * Executes after a payment instrument is successfully added or created via a POST request.
 * This hook is used to perform any necessary post-processing or data enrichment.
 *
 * @param {dw.order.Order} order - The basket object that the payment instrument was added to.
 */
exports.afterPOST = function (order) {
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}
	var paymentInstruments = order.getPaymentInstruments();
	var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers.js');
	var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');

	if (order.getTotalGrossPrice().value === 0.00) {
		// CASE A: 0 Amount Order (Skip Payment Gateways, just Place & Integrate)
		var zeroAmountResult = paymentHelpers.addZeroAmountOrder(order);
		if (zeroAmountResult.isError()) {
			return zeroAmountResult;
		}
	} else {
		for (var i = 0; i < paymentInstruments.length; i++) {
			var paymentInstrument = paymentInstruments[i];
			try {
				if (paymentInstrument.getPaymentMethod() === 'STRIPE') {
					paymentHelpers.handleStripePayment(order, paymentInstrument);
				} else if (paymentInstrument.getPaymentMethod() === 'PAYPAL') {
					paypalHelper.handlePayPalPayment(order, paymentInstrument);
				} else if (paymentInstrument.getPaymentMethod() === 'COD') {
					paymentHelpers.handleCODPayment(order, paymentInstrument);
				} else if (paymentInstrument.getPaymentMethod() === 'WALLET') {
					paymentHelpers.handleWalletPayment(order, paymentInstrument);
				} else if (paymentInstrument.getPaymentMethod() === 'BREEZE') {
					paymentHelpers.handleBreezePayment(order, paymentInstrument);
				}
			} catch (e) {
				Logger.error('Full stack trace: {0}', e.stack);
				Logger.error('Error Message: {0}', e.message);
				Transaction.wrap(function () {
					// @ts-ignore
					order.custom.orderStatus = 8;
					OrderMgr.failOrder(order, true);
				});
				return new Status(Status.ERROR, 'ORDER_CREATION_FAILED', e.message);
			}
		}
	}



	// This handles the "EXCHANGE-DIFFERENT" deferred flow.
	// Checks if this new order carries an "Original Order ID" from the basket.
	if ('exchangeOriginalOrderId' in order.custom && order.custom.exchangeOriginalOrderId) {
		try {
			var originalOrderNo = order.custom.exchangeOriginalOrderId;
			var returnedSku = order.custom.exchangeReturnedItemId;

			// Fetch the Original Order
			var originalOrder = OrderMgr.getOrder(originalOrderNo);

			if (originalOrder) {
				Transaction.wrap(function () {
					var lineItems = originalOrder.getProductLineItems().iterator();
					originalOrder.custom.exchangeProcessing = true;
					while (lineItems.hasNext()) {
						var pli = lineItems.next();

						// Find the matching item that is being returned/exchanged
						if (pli.productID === returnedSku) {
							// LINKING: Save the New Order ID on the Old Item
							pli.custom.exchangeOrder = order.orderNo;

							pli.custom.lineItemStatus = 21;
							pli.custom.returnExchangeRequestDate = new Date();
							// originalOrder.custom.UpdateFlowFlag = true;

							// Update Reason/Description if passed along
							if (order.custom.exchangeReturnReason) {
								pli.custom.Reason = order.custom.exchangeReturnReason;
							}
							if (order.custom.exchangeReturnDescription) {
								pli.custom.Description = order.custom.exchangeReturnDescription;
							}
						}
					}
				});

				Logger.info('Successfully linked Exchange Order {0} to Original Order {1}', order.orderNo, originalOrderNo);
			} else {
				Logger.warn('Exchange Link Skipped: Original Order {0} not found for New Order {1}', originalOrderNo, order.orderNo);
			}

		} catch (ex) {
			// We generally log this but DO NOT fail the order here, 
			// because the new order has already been paid/placed successfully above.
			Logger.error('Error linking Exchange Order: {0}', ex.message);
		}
	}

	return new Status(Status.OK);
};
