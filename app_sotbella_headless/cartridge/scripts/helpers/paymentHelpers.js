'use strict';

var Logger = require('dw/system/Logger').getLogger('StripeWebhook', 'StripeWebhook');
var Encoding = require('dw/crypto/Encoding');
var Mac = require('dw/crypto/Mac');
var Bytes = require('dw/util/Bytes');
var PaymentMgr = require('dw/order/PaymentMgr');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');

/**
 * Verifies the signature of a Stripe webhook request to ensure it's authentic.
 * @param {string} payload - The raw request body from the Stripe webhook.
 * @param {string} sigHeader - The value from the 'Stripe-Signature' request header.
 * @param {string} secret - The webhook signing secret from your Stripe dashboard.
 * @returns {boolean} Returns true if the signature is valid, otherwise false.
 */
function verifyStripeSignature(payload, sigHeader, secret) {
	if (!sigHeader || !secret) return false;
	try {
		var elements = sigHeader.split(',');
		var timestamp, signature;
		elements.forEach(function (el) {
			var [key, value] = el.split('=');
			if (key === 't') timestamp = value;
			if (key === 'v1') signature = value;
		});
		if (!timestamp || !signature) return false;
		var signedPayload = timestamp + '.' + payload;
		var mac = new Mac(Mac.HMAC_SHA_256);
		var digest = mac.digest(new Bytes(signedPayload, 'UTF-8'), new Bytes(secret, 'UTF-8'));
		var computedSignature = Encoding.toHex(digest);

		return timingSafeCompare(signature, computedSignature);
	} catch (e) {
		Logger.error('verifyStripeSignature failed: {0}', e.toString());
		return false;
	}
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 * This method ensures that the comparison operation takes the same amount of
 * time regardless of whether the strings match or not, which is crucial
 * for security-sensitive operations like comparing cryptographic signatures.
 * @param {string} a - The first string for comparison.
 * @param {string} b - The second string for comparison.
 * @returns {boolean} True if the strings are equal, false otherwise.
 */
function timingSafeCompare(a, b) {
	if (a.length !== b.length) return false;
	var result = 0;
	for (var i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

function handleStripePayment(order, paymentInstrument) {
	var stripeService = require('../../services/stripeService');
	var customer = order.customer;
	var stripeCustomerId = customer.profile ? customer.profile.custom.stripeCustomerId : null;

	// --- 2. Ensure Stripe customer (registered only) ---
	if (!stripeCustomerId && customer.authenticated && customer.registered) {
		var createResp = stripeService.createCustomer.call({
			email: customer.profile.email,
			name: customer.profile.firstName + ' ' + customer.profile.lastName,
		});
		if (createResp.ok && createResp.object && createResp.object.id) {
			stripeCustomerId = createResp.object.id;
			Transaction.wrap(function () {
				customer.profile.custom.stripeCustomerId = stripeCustomerId;
			});
		} else {
			Logger.error('Stripe: Failed to create customer');
			return;
		}
	}
	// --- 3. Create PaymentIntent ---
	if (!order.totalGrossPrice || order.totalGrossPrice.value <= 0) {
		Logger.warn('Stripe: Skipping PI creation, basket total invalid.');
		return;
	}

	var piResp = stripeService.createPaymentIntent.call({
		amount: Math.round(order.totalGrossPrice.value * 100),
		currency: order.totalGrossPrice.currencyCode,
		customer: stripeCustomerId,
		setup_future_usage: 'on_session',
		metadata: {
			orderNo: order.orderNo,
			orderToken: order.orderToken,
		},
	});
	if (!piResp.ok || !piResp.object || !piResp.object.id) {
		Logger.error('Stripe: Failed to create PaymentIntent');
		return;
	}
	var intent = piResp.object;
	// --- 4. Persist intent IDs into the new PI ---
	var paymentInstruments = order.getPaymentInstruments();
	var paymentInstrument = null;

	if (paymentInstruments.length > 0) {
		for (var i = 0; i < paymentInstruments.length; i++) {
			var paymentIns = paymentInstruments[i];
			var paymentMethodId = paymentInstruments[i].paymentMethod;
			if (paymentMethodId === 'STRIPE') {
				paymentInstrument = paymentIns;
				break;
			}
		}
	}
	Transaction.wrap(function () {
		paymentInstrument.custom.stripe_payment_intent_id = intent.id;
		paymentInstrument.custom.stripe_client_secret = intent.client_secret;
	});
	Logger.info('Stripe: PaymentIntent {0} created', intent.id);
}

/**
 * Handles the final processing and order creation for Cash on Delivery (COD) payments.
 * It replaces the payment instruments in the basket with a single, finalized COD instrument,
 * creates an order, and sets its status to confirmed but not paid.
 * @param {dw.order.Order} order - The current customer's basket.
 * @param {object} paymentInstrument - The payment instrument from API call.
 */
function handleCODPayment(order, paymentInstrument) {
	var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService') 
	var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
	var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
    var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');

	Transaction.wrap(function () {
		var handlePaymentsResult = handlePayments(order, null);
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
		order.setPaymentStatus(Order.PAYMENT_STATUS_NOTPAID);
		order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);
		// @ts-ignore
		order.custom.orderStatus = 0;
		updateTotalOrdersAndSpent(order);
		sendRefersionDataHelper.sendRefersionData(order);

		var createOrderRes = callCreateSaleOrder(order, function (order, token) {
		 return UnicommerceCreatOrderService.createSaleOrder(order, token);
		}); 
        emailHelper.sendOrderConfirmMail(order);

        if (createOrderRes.object.successful == false) {
			Logger.error('Unicommerce: Failed to create order for COD order {0}. Error: {1}', order.orderNo, createOrderRes.object.errors);
		} else {
			Logger.info('Unicommerce: Successfully created order for COD order {0}.', order.orderNo);
			order.exportStatus = 1;
			order.custom.UpdateFlowFlag = true;
		}
	});

	if (order) {
		Logger.info('COD Order {0} was placed successfully.', order.orderNo);
	} else {	
		Logger.error('COD Order placement failed.');
	}
}

	/**
	 * Handles the application of payment instruments to the basket.
	 * @param {dw.order.Order} order - The current user's basket.
	 * @param {Object} paymentInstrument - An object containing information for the new payment instrument, e.g., { paymentMethodId: 'STRIPE_CREDIT' }.
	 */
	function handleWalletPayment(order, paymentInstrument) { 
		var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService') 
		var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
		var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
        var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
		var walletHelpers = require('*/cartridge/scripts/helpers/walletHelper');
		var paymentInstruments = order.getPaymentInstruments();
		if (paymentInstruments.length !== 1 || !paymentInstruments[0].paymentMethod.equals('WALLET')) {
        // If it's a split payment or another method, we exit this specific handler
        return; 
    	}
		Transaction.wrap(function () {
        var walletPI = paymentInstruments[0];
        var customerEmail = order.customerEmail;
        var amount = walletPI.paymentTransaction.amount.value;
        var orderNo = order.orderNo;

        // 1. Debit the Wallet
        var debitResult = walletHelpers.debitCustomerWallet(
            customerEmail,
            amount,
            'order_deduction',              // type
            'Payment for Order ' + orderNo, // description
            'Order Payment',                // remarks
            orderNo                         // referenceId
        );

        if (!debitResult.success) {
            // Fail the order if the wallet deduction fails
            // @ts-ignore
            order.custom.orderStatus = 8;
            OrderMgr.failOrder(order, true);
            Logger.error('Wallet Debit Failed for Order {0}: {1}', orderNo, debitResult.error);
            throw new Error('Wallet Debit Failed: ' + debitResult.error);
        }
		var apiResponse = debitResult.data;
		if (apiResponse && apiResponse.data && apiResponse.data.transaction && apiResponse.data.transaction._id) {
                var walletTxnId = apiResponse.data.transaction._id;
                walletPI.paymentTransaction.setTransactionID(walletTxnId);
                Logger.info('Wallet Transaction ID {0} saved for Order {1}', walletTxnId, orderNo);
        } else {
                Logger.warn('Wallet debited for Order {0}, but Transaction ID could not be parsed.', orderNo);
            }
        // 2. Place the Order
        // @ts-ignore
        order.custom.orderStatus = 0;
        
        var placeOrderStatus = OrderMgr.placeOrder(order);
        if (placeOrderStatus.isError()) {
            // @ts-ignore
            order.custom.orderStatus = 8;
            OrderMgr.failOrder(order, true);
            throw new Error('Order placement failed for order ' + order.orderNo);
        }

        // 3. Update Statuses
        // Since this is a full wallet payment, the order is immediately PAID
        order.setPaymentStatus(Order.PAYMENT_STATUS_PAID);
        order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);
        // @ts-ignore
        order.custom.orderStatus = 0;
        
        // 4. Post-Processing
        updateTotalOrdersAndSpent(order);
        sendRefersionDataHelper.sendRefersionData(order);

        // 5. Unicommerce Call
        var createOrderRes = callCreateSaleOrder(order, function (order, token) {
            return UnicommerceCreatOrderService.createSaleOrder(order, token);
        });

		emailHelper.sendOrderConfirmMail(order);
        if (createOrderRes.object.successful == false) {
            Logger.error('Unicommerce: Failed to create order for Wallet order {0}. Error: {1}', order.orderNo, createOrderRes.object.errors);
        } else {
            Logger.info('Unicommerce: Successfully created order for Wallet order {0}.', order.orderNo);
            order.exportStatus = 1;
            order.custom.UpdateFlowFlag = true;
        }
    });

    if (order && order.status.value !== Order.ORDER_STATUS_FAILED) {
        Logger.info('Wallet Order {0} was placed successfully.', order.orderNo);
    }
	}

/**
 * Checks for a WALLET payment instrument and attempts to debit the customer's wallet.
 * If successful, it updates the Payment Instrument with the Wallet Transaction ID.
 * @param {dw.order.Order} order - The order object.
 * @returns {Object} Result object { success: boolean, error: string }
 */
function processWalletPayment(order) {
	var walletHelpers = require('*/cartridge/scripts/helpers/walletHelper');

    // 1. Check if there is a WALLET payment instrument
    var paymentInstruments = order.getPaymentInstruments('WALLET');

    if (paymentInstruments.length === 0) {
        // No wallet payment involved, so we consider this a success (skip)
        return { success: true };
    }

    var walletPI = paymentInstruments[0];
    var amount = walletPI.paymentTransaction.amount.value;
    var email = order.customerEmail;
    var orderNo = order.orderNo;

    // 2. Call the Debit Service
    var debitResult = walletHelpers.debitCustomerWallet(
        email,
        amount,
        'order_deduction',
        'Payment for Order ' + orderNo,
        'Order Payment', 
        orderNo
    );

    // 3. Handle Failure
    if (!debitResult.success) {
        Logger.error('Wallet Debit Failed for Order {0}: {1}', orderNo, debitResult.error);
        return { success: false, error: debitResult.error };
    }

    // 4. Handle Success & Save Transaction ID
    // The helper returns the full API response in 'debitResult.data'
    // Response structure: { success: true, data: { transaction: { _id: "..." } } }
    var apiResponse = debitResult.data;
    var walletTxnId = null;

    if (apiResponse && apiResponse.data && apiResponse.data.transaction && apiResponse.data.transaction._id) {
        walletTxnId = apiResponse.data.transaction._id;
    }

    if (walletTxnId) {
        // We assume this function is called inside a Transaction.wrap from the controller.
        // If not, you might need to wrap this specific line, but usually, it's safe if the caller handles it.
        walletPI.paymentTransaction.setTransactionID(walletTxnId);
        Logger.info('Wallet successfully debited {0} for Order {1}. Wallet Txn ID: {2}', amount, orderNo, walletTxnId);
    } else {
        Logger.warn('Wallet debited for Order {0}, but Transaction ID could not be parsed from response.', orderNo);
		return { success: false, error: 'Failed to retrieve Wallet Transaction ID' };
    }
    return { success: true };
}
/**
 * Updates the payment transactions of a given order with details from a Stripe Payment Intent.
 * This function iterates through the order's payment instruments and sets the transaction ID
 * and payment processor on each payment transaction.
 * @param {dw.order.Order} order - The newly created order whose payment transactions need updating.
 * @param {Object} paymentIntent - The Payment Intent object returned from a successful Stripe API call.
 */
function handlePayments(order, paymentIntent) {
	var result = {};
	if (!order) {
		result.error = true;
		result.message = 'Missing Order';
		return result;
	}
	var paymentInstruments = order.getPaymentInstruments();
	if (paymentInstruments.length === 0) {
		result.error = true;
		result.message = 'No Payment Instruments in Order';
		return result;
	}
	if (paymentInstruments.length > 0) {
		for (var i = 0; i < paymentInstruments.length; i++) {
			var paymentMethodId = paymentInstruments[i].paymentMethod;
			var paymentMethod = PaymentMgr.getPaymentMethod(paymentMethodId);
			if (paymentMethod) {
				var paymentProcessor = paymentMethod.getPaymentProcessor();
				var paymentTransaction = paymentInstruments[i].getPaymentTransaction();
				if (paymentMethodId === 'STRIPE') paymentTransaction.setTransactionID(paymentIntent.latest_charge);
				paymentTransaction.setPaymentProcessor(paymentProcessor);
			}
		}
	}
	return result;
}

function cancelStripePaymentIntent(paymentIntentId) {
	var result = {};
	var stripeService = require('../../services/stripeService');
	var createResp = stripeService.cancelPaymentIntent.call({
		paymentIntentId: paymentIntentId,
	});
	if (!createResp.ok) {
		Logger.error('Stripe: Failed to cancel payment intent. Error: ' + createResp);
		return;
	}
	return result;
}


function updateTotalOrdersAndSpent(order) {
	try {
		var customerProfile = order.getCustomer() && order.getCustomer().getProfile();
		if (customerProfile) {
			var currentTotalOrders = customerProfile.custom.totalOrders || 0;
			var currentTotalSpent = customerProfile.custom.totalSpent || 0;
			var orderTotal = order.getTotalGrossPrice().getValue();

			customerProfile.custom.totalOrders = currentTotalOrders + 1;
			customerProfile.custom.totalSpent = currentTotalSpent + orderTotal;
		}
	} catch (e) {
		Logger.error('Error updating customer profile totals for order {0}: {1}', order.orderNo, e.message);
	}
}

/**
 * Handles Breeze Payment Logic for Order Creation (OCAPI afterPOST).
 * Generates a signature and payload based on the created Order and saves it
 * to the Order's custom attributes for the frontend to use.
 * * @param {dw.order.Order} order - The newly created order.
 * @param {dw.order.OrderPaymentInstrument} paymentInstrument - The Breeze payment instrument.
 */
function handleBreezePayment(order, paymentInstrument) {
    var BreezeHelper = require('*/cartridge/scripts/helpers/BreezeHelper');
    
    try {
        
        var breezeItems = [];
        var productLineItems = order.getProductLineItems();
        var iter = productLineItems.iterator();
		var calculatedTotalDiscount = 0;
        while (iter.hasNext()) {
            var pli = iter.next();
			var product = pli.getProduct();
            // Calculate Item Prices (Decimal)
            var quantity = pli.getQuantityValue();
            var itemBaseDecimal = pli.getBasePrice().getValue(); // Unit Base Price
            var itemAdjustedDecimal = pli.getAdjustedPrice().getValue(); // Total Line Price (Adjusted)
            var unitAdjustedDecimal = itemAdjustedDecimal / quantity;

			// 2. Calculate Discount (Per Item)
            var unitDiscountDecimal = itemBaseDecimal - unitAdjustedDecimal;
            var totalLineDiscountDecimal = unitDiscountDecimal * quantity;
			calculatedTotalDiscount += totalLineDiscountDecimal;
			var imageUrl = "";
            if (product) {
                var img = product.getImage('large', 0) || product.getImage('medium', 0) || product.getImage('small', 0);
                if (img) {
                    imageUrl = img.getAbsURL().toString();
                }
            }
            
            breezeItems.push({
                id: pli.getProductID(),
                title: pli.getProductName(),
				image: imageUrl,
                quantity: quantity,
                discount: Math.round(totalLineDiscountDecimal * 100),     // *100
                initialPrice:Math.round(itemBaseDecimal * 100), // *100
                finalPrice: Math.round(unitAdjustedDecimal * 100),   // *100 (Final Unit Price)
            });
        }	
		
		var shippingAttributes = {};
		var shippingTotalValue = 0.0;
        var shipment = order.getDefaultShipment();
		if (shipment && shipment.shippingMethod) {
			shippingTotalValue = shipment.getShippingTotalPrice().getValue();
            // Get Shipping Price (Integer)
            // Note: getAdjustedShippingTotalPrice() includes discounts on shipping
            var shippingPrice = Math.round(shipment.getAdjustedShippingTotalPrice().getValue() * 100);
            
            shippingAttributes = {
                shipping: {
                    type: shipment.shippingMethod.displayName,
                    price: shippingPrice
                }
            };
        }
        // Construct Main Payload
		// Initial: Merchandize Total (Pre-discounts)
		var piAmount = paymentInstrument.getPaymentTransaction().getAmount();
        var piAmountValue = piAmount ? piAmount.getValue() : 0;
        var cartTotalPrice = Math.round(piAmountValue * 100);
		var merchTotal = order.getMerchandizeTotalPrice().getValue();
        var cartInitialPrice = Math.round((merchTotal + shippingTotalValue) * 100);
		// Total: Grand Total (Post-discounts + Tax + Shipping)
		// Discount: Explicitly calculated from items + order level adjustments
		var cartTotalDiscount = cartInitialPrice - cartTotalPrice;
        
        var breezeCartObject = {
            id: order.getOrderNo(), // Use Order Number as the Transaction ID reference
            initialPrice:cartTotalPrice,
            totalPrice: cartTotalPrice,
            totalDiscount: cartTotalDiscount,
            itemCount: productLineItems.length,
            currency: order.getCurrencyCode(),
            items: breezeItems,
			attributes: shippingAttributes
        };

        // 3. Generate Signature
        // Ensure 'breeze_cart_private_key' is configured in BM > Private Keys
        var result = BreezeHelper.createSignature(breezeCartObject, 'breeze_cart_private_key',false);

        // 4. Save to Order Custom Attributes
        // We use Transaction.wrap because we are modifying the Order object
        Transaction.wrap(function () {
            // Ensure these attributes exist in System Object Type > Order
            order.custom.breezeSignature = result.signature;
            order.custom.breezePayload = result.signaturePayload;
            
            // Optionally set the transaction ID on the payment instrument
            var paymentTransaction = paymentInstrument.getPaymentTransaction();
			var paymentMethodID = paymentInstrument.getPaymentMethod();
			var paymentMethod = PaymentMgr.getPaymentMethod(paymentMethodID);

			if (paymentMethod && paymentMethod.getPaymentProcessor()) {
                var paymentProcessor = paymentMethod.getPaymentProcessor();
                paymentTransaction.setPaymentProcessor(paymentProcessor);
            } else {
                Logger.warn('No Payment Processor found for method: {0}', paymentMethodID);
            }
            paymentTransaction.setTransactionID(order.getOrderNo());
        });

        Logger.info('Breeze Payment Signature generated for Order {0}', order.getOrderNo());

    } catch (e) {
        Logger.error('Error in handleBreezePayment: {0}', e.message);
        throw new Error('Failed to generate Breeze Signature: ' + e.message);
    }
}

/**
 * Initiates a refund for a specific transaction via Stripe.
 * @param {string} transactionId - The Stripe Charge ID (e.g., ch_xxx) or PaymentIntent ID (pi_xxx) to refund.
 * @param {number} amount - The amount to refund in cents (e.g., 1099 for $10.99).
 * @returns {Object} Result object { success: boolean, refundId: string, error: string }
 */
function handleStripeRefund(transactionId, amount) {
    // 1. Require the service registry file where 'createRefund' is defined
    var stripeService = require('*/cartridge/services/stripeService');

    try {
        var params = {
            charge: transactionId,
            amount: amount
        };

        var result = stripeService.createRefund.call(params);

        if (result.ok && result.object && result.object.status === 'succeeded') {
            Logger.info('Stripe Refund Successful. ID: {0}', result.object.id);
            return {
                success: true,
                refundId: result.object.id,
                rawResponse: result.object
            };
        } else {
            var errorMessage = result.errorMessage || 'Unknown Stripe Error';
            if (result.object && result.object.error) {
                errorMessage = result.object.error.message;
            }

            Logger.error('Stripe Refund Failed for transaction {0}: {1}', transactionId, errorMessage);
            return {
                success: false,
                error: errorMessage
            };
        }

    } catch (e) {
        Logger.error('Exception in handleStripeRefund: {0}', e.message);
        return {
            success: false,
            error: e.message
        };
    }
}

/**
 * Helper Method: addZeroAmountOrder
 * Handles order placement and integrations for orders with 0.00 total.
 * Does NOT handle Exchange Linking (that is done in afterPOST).
 */
function addZeroAmountOrder(order) {
    var Logger = require('dw/system/Logger');
    var OrderMgr = require('dw/order/OrderMgr');
    var Order = require('dw/order/Order');
    var Transaction = require('dw/system/Transaction');
    var Status = require('dw/system/Status');
    
    // Import Helpers
    var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService');
    var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
    var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
    var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');

    try {
        Transaction.wrap(function () {
            // 1. Place the Order
            // @ts-ignore
            order.custom.orderStatus = 0; 
            
            var placeOrderStatus = OrderMgr.placeOrder(order);
            if (placeOrderStatus.isError()) {
                // @ts-ignore
                order.custom.orderStatus = 8; 
                OrderMgr.failOrder(order, true);
                throw new Error('Order placement failed for 0 amount order ' + order.orderNo);
            }

            // 2. Set Final Order Statuses
            order.setPaymentStatus(Order.PAYMENT_STATUS_PAID); 
            order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);
            order.setExportStatus(Order.EXPORT_STATUS_READY);

            updateTotalOrdersAndSpent(order);
            // 3. Update Metrics & Refersion
            sendRefersionDataHelper.sendRefersionData(order);

            // 4. Unicommerce Export
            var createOrderRes = callCreateSaleOrder(order, function (ord, token) {
                return UnicommerceCreatOrderService.createSaleOrder(ord, token);
            });

            emailHelper.sendOrderConfirmMail(order);
            if (createOrderRes.object.successful === false) {
                Logger.error('Unicommerce: Failed to create order for 0 Amount Order {0}. Error: {1}', order.orderNo, JSON.stringify(createOrderRes.object.errors));
            } else {
                Logger.info('Unicommerce: Successfully created order for 0 Amount Order {0}.', order.orderNo);
                order.exportStatus = 1;
                order.custom.UpdateFlowFlag = true;
            }
        });

        Logger.info('0 Amount Order {0} was placed successfully.', order.orderNo);
        return new Status(Status.OK);

    } catch (e) {
        Logger.error('Full stack trace: {0}', e.stack);
        Logger.error('Error Message in addZeroAmountOrder: {0}', e.message);
        
        if (order.status.value !== Order.ORDER_STATUS_FAILED) {
            Transaction.wrap(function () {
                // @ts-ignore
                order.custom.orderStatus = 8;
                OrderMgr.failOrder(order, true);
            });
        }
        return new Status(Status.ERROR, 'ORDER_CREATION_FAILED', e.message);
    }
}

module.exports = {
	updateTotalOrdersAndSpent,
	verifyStripeSignature,
	handlePayments,
	handleStripePayment,
	handleCODPayment,
	handleWalletPayment,
	cancelStripePaymentIntent,
	handleBreezePayment:handleBreezePayment,
	handleStripeRefund: handleStripeRefund,
	processWalletPayment: processWalletPayment,
	addZeroAmountOrder: addZeroAmountOrder
};
