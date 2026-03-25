'use strict';

var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');
var TaxMgr = require('dw/order/TaxMgr');
var ArrayList = require('dw/util/ArrayList');
var Transaction = require('dw/system/Transaction');

/**
 * Determines the refund amount.
 * STRICT RULE: Shipping is only added if 'cancelledContext' is true AND all other items are already cancelled.
 * UPDATE: Adds TAX calculated on the prorated price.
 */
function calculateRefundAmount(order, sku, cancelledContext) {
    var allPlis = order.getProductLineItems();
    var matchingPlis = [];
    var otherPlis = [];

    // 1. Separate Matching PLIs vs Other PLIs
    var iter = allPlis.iterator();
    while (iter.hasNext()) {
        var pli = iter.next();
        if (pli.getProductID() === sku) {
            matchingPlis.push(pli);
        } else {
            otherPlis.push(pli);
        }
    }

    if (matchingPlis.length === 0) {
        return 0.0;
    }

    // 2. Calculate Base Refund
    var refundAmount = 0.0;
    var taxationPolicy = TaxMgr.getTaxationPolicy(); // Get Policy (Net vs Gross)

    matchingPlis.forEach(function (pli) {
        var lineValue = 0.0;

        // A. Get the Price (Prefer Prorated to handle Order-Level Discounts)
        if (pli.getProratedPrice().available) {
            lineValue = pli.getProratedPrice().getValue();
        } else {
            lineValue = pli.getAdjustedPrice().getValue();
        }

        // B. Handle Tax based on Policy
       // B. Handle Tax based on Policy
        if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
            var lineTax = 0.0;

            // Priority 1: Use actual stored tax values (Most accurate)
            if (pli.getAdjustedTax().available) {
                lineTax = pli.getAdjustedTax().getValue();
            } else if (pli.getTax().available) {
                lineTax = pli.getTax().getValue();
            } else if (pli.getTaxRate()) {
                // Priority 2: Fallback to calculation only if no stored tax exists
                lineTax = lineValue * pli.getTaxRate();
            }

            // Logic: If we are using Prorated Price (which might be different from Adjusted Price),
            // we must scale the tax proportionally.
            var adjPrice = pli.getAdjustedPrice().getValue();
            if (adjPrice > 0 && Math.abs(lineValue - adjPrice) > 0.01) {
                 var ratio = lineValue / adjPrice;
                 lineTax = lineTax * ratio;
            }

            lineValue += lineTax;
        }
        // GROSS Policy (INR/UK/EU): Price ALREADY includes tax.
        // Do 
        refundAmount += lineValue;
    });

    // 3. Determine if Shipping should be included
    var shouldRefundShipping = false;
    var refundShippingPref = Site.getCurrent().getCustomPreferenceValue('refundShippingCharges');

    if (refundShippingPref) {
        shouldRefundShipping = true;
    } else if (cancelledContext) {
        var allOthersCancelled = true;
        if (otherPlis.length > 0) {
            otherPlis.forEach(function (otherPli) {
                // Check active statuses (Not Cancelled/Refunded)
                // Assuming status 3 is Cancelled   
                if (otherPli.custom.lineItemStatus != 3) {
                    allOthersCancelled = false;
                }
            });
        }
        if (allOthersCancelled) {
            shouldRefundShipping = true;
            Logger.getLogger('RefundHelper').info('Last active items being cancelled. Triggering Shipping Refund.');
        }
    }

    // 4. Add Shipping if applicable
    if (shouldRefundShipping) {
        if (order.getAdjustedShippingTotalPrice().available) {
            var shippingTotal = order.getAdjustedShippingTotalPrice().getValue();

            // Only add Shipping Tax if policy is NET
            if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                if (order.getShippingTotalTax().available) {
                    shippingTotal += order.getShippingTotalTax().getValue();
                }
            }
            // For GROSS, AdjustedShippingTotalPrice usually includes tax already.

            if (shippingTotal > 0) {
                refundAmount += shippingTotal;
            }
        }
    }

    return parseFloat(refundAmount.toFixed(2));
}
// =================================================================
// PAYMENT GATEWAY SPECIFIC HANDLERS
// =================================================================

function getPaymentTransactionRefundedAmount(paymentTransaction) {
    var refundedAmount = 0;
    var refunds = paymentTransaction && paymentTransaction.custom ? paymentTransaction.custom.refunds : null;

    if (!refunds) {
        return refundedAmount;
    }

    if (refunds.toArray) {
        refunds = refunds.toArray();
    }

    if (!refunds.length) {
        return refundedAmount;
    }

    for (var i = 0; i < refunds.length; i++) {
        try {
            var refundRecord = typeof refunds[i] === 'string' ? JSON.parse(refunds[i]) : refunds[i];
            if (refundRecord && refundRecord.amount) {
                refundedAmount += parseFloat(refundRecord.amount) || 0;
            }
        } catch (e) {
            Logger.error('Unable to parse refund record: {0}', e.message);
        }
    }

    return parseFloat(refundedAmount.toFixed(2));
}

function getRefundPriority(method) {
    switch (String(method)) {
        case 'WALLET':
            return 0;
        case 'PAYPAL':
            return 1;
        case 'STRIPE':
        case 'CREDIT_CARD':
            return 2;
        case 'BREEZE':
            return 3;
        default:
            return 99;
    }
}

function buildRefundAllocations(order, amountToRefund) {
    var supportedInstruments = [];
    var paymentInstruments = order.getPaymentInstruments();
    var iterator = paymentInstruments.iterator();

    while (iterator.hasNext()) {
        var paymentInstrument = iterator.next();
        var method = paymentInstrument.getPaymentMethod();
        var originalAmount = paymentInstrument.getPaymentTransaction().getAmount()
            ? paymentInstrument.getPaymentTransaction().getAmount().getValue()
            : 0;
        var refundedAmount = getPaymentTransactionRefundedAmount(paymentInstrument.getPaymentTransaction());
        var remainingAmount = parseFloat((originalAmount - refundedAmount).toFixed(2));

        if (remainingAmount <= 0 || getRefundPriority(method) === 99) {
            continue;
        }

        supportedInstruments.push({
            paymentInstrument: paymentInstrument,
            method: method,
            remainingAmount: remainingAmount,
            priority: getRefundPriority(method)
        });
    }

    supportedInstruments.sort(function (left, right) {
        return left.priority - right.priority;
    });

    var remainingRefund = parseFloat(amountToRefund.toFixed(2));
    var allocations = [];

    for (var i = 0; i < supportedInstruments.length && remainingRefund > 0; i++) {
        var allocationAmount = Math.min(remainingRefund, supportedInstruments[i].remainingAmount);

        if (allocationAmount > 0) {
            allocations.push({
                paymentInstrument: supportedInstruments[i].paymentInstrument,
                method: supportedInstruments[i].method,
                amount: parseFloat(allocationAmount.toFixed(2))
            });
            remainingRefund = parseFloat((remainingRefund - allocationAmount).toFixed(2));
        }
    }

    return {
        allocations: allocations,
        remainder: remainingRefund
    };
}

function executeRefundAllocation(order, allocation) {
    switch (allocation.method) {
        case 'WALLET':
            return refundToWallet(order, allocation.amount, allocation.paymentInstrument);
        case 'PAYPAL':
            return refundToPayPal(order, allocation.amount, allocation.paymentInstrument);
        case 'STRIPE':
        case 'CREDIT_CARD':
            return refundToStripe(order, allocation.amount, allocation.paymentInstrument);
        case 'BREEZE':
            return refundToBreeze(order, allocation.amount, allocation.paymentInstrument);
        default:
            return {
                success: false,
                method: allocation.method,
                error: 'Unsupported refund method'
            };
    }
}

function refundAcrossInstruments(order, amountToRefund) {
    var allocationPlan = buildRefundAllocations(order, amountToRefund);

    if (!allocationPlan.allocations.length) {
        return { success: false, message: 'No supported payment method found' };
    }

    if (allocationPlan.remainder > 0) {
        return {
            success: false,
            message: 'Refund amount exceeds refundable payment instrument balance'
        };
    }

    var responses = [];
    for (var i = 0; i < allocationPlan.allocations.length; i++) {
        var refundResult = executeRefundAllocation(order, allocationPlan.allocations[i]);
        responses.push(refundResult);

        if (!refundResult.success) {
            return {
                success: false,
                message: refundResult.error || refundResult.message || 'Refund failed',
                partialResults: responses
            };
        }
    }

    return {
        success: true,
        method: responses.length === 1 ? responses[0].method : 'MULTI',
        amount: amountToRefund,
        transactionId: responses
            .map(function (response) { return response.transactionId; })
            .filter(function (transactionId) { return transactionId; })
            .join(','),
        results: responses
    };
}

function refundToWallet(order, amount, paymentInstrument) {
    Logger.info('Refund Strategy: WALLET. Amount: {0}', amount);

    var walletHelper = require('*/cartridge/scripts/helpers/walletHelper');

    // 1. Prepare Data
    var customerEmail = order.getCustomerEmail();
    var orderNo = order.getOrderNo();

    var type = 'refund';
    var description = 'Refund for Order #' + orderNo;
    var remarks = 'Refund processed for Order #' + orderNo;
    var referenceId = orderNo;

    var targetInstrument = paymentInstrument;
    if (!targetInstrument) {
        var paymentInstruments = order.getPaymentInstruments();
        var iter = paymentInstruments.iterator();
        while (iter.hasNext()) {
            var pi = iter.next();
            if (pi.paymentMethod.equals('WALLET')) {
                targetInstrument = pi;
                break;
            }
        }
    }

    if (!targetInstrument) {
        return {
            success: false,
            method: 'WALLET',
            error: 'Wallet payment instrument not found'
        };
    }

    var targetPaymentTransaction = targetInstrument.paymentTransaction;

    // 2. Call Wallet Helper
    var result = walletHelper.creditCustomerWallet(
        customerEmail,
        amount,
        type,
        description,
        remarks,
        referenceId
    );

    // 3. Handle Result
    if (result.success) {
        Transaction.wrap(function () {
            var responseData = result.data;
            var transactionDetails = responseData.data.transaction
            var refundData = {
                transactionId: transactionDetails._id, // Map _id from response
                amount: transactionDetails.amount,
                currency: 'INR',
                date: transactionDetails.createdAt || new Date().toISOString()
            };
            var currentRefunds = targetPaymentTransaction.custom.refunds || [];
            var refundList = new ArrayList(currentRefunds);
            refundList.add(JSON.stringify(refundData));
            targetPaymentTransaction.custom.refunds = refundList;
        })
        return {
            success: true,
            method: 'WALLET',
            amount: amount,
            transactionId: referenceId // Storing OrderNo as the transaction ref
        };
    } else {
        Logger.error('Wallet Refund Failed for Order {0}: {1}', orderNo, result.error);
        return {
            success: false,
            method: 'WALLET',
            error: result.error
        };
    }
}

function refundToStripe(order, amount, paymentInstrument) {
    Logger.info('Refund Strategy: STRIPE. Amount: {0}', amount);
    var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers');

    // 1. Get Transaction ID from the Payment Instrument
    var transactionId = null;
    var targetInstrument = paymentInstrument;
    var targetPaymentTransaction = null;
    if (!targetInstrument) {
        var paymentInstruments = order.getPaymentInstruments();
        var iter = paymentInstruments.iterator();
        while (iter.hasNext()) {
            var pi = iter.next();
            if (pi.paymentMethod.equals('STRIPE') || pi.paymentMethod.equals('CREDIT_CARD')) {
                targetInstrument = pi;
                break;
            }
        }
    }

    if (targetInstrument) {
        targetPaymentTransaction = targetInstrument.paymentTransaction;
        transactionId = targetPaymentTransaction.transactionID;
    }

    if (!transactionId) {
        Logger.error('Stripe Refund Failed: No Transaction ID found on Order {0}', order.getOrderNo());
        return { success: false, method: 'STRIPE', error: 'No Transaction ID found' };
    }

    var amountInCents = Math.round(amount * 100);
    var result = paymentHelpers.handleStripeRefund(transactionId, amountInCents);

    if (result.success) {
        Transaction.wrap(function () {
            var stripeResponse = result.rawResponse || {};
            var refundData = {
                id: stripeResponse.id || result.refundId,
                amount: amount,
                date: stripeResponse.created ? new Date(stripeResponse.created * 1000).toISOString() : new Date().toISOString(), // Convert Unix Timestamp (seconds) to JS Date (ms)
                status: stripeResponse.status || 'succeeded'
            };
            var currentRefunds = targetPaymentTransaction.custom.refunds || [];
            var refundList = new ArrayList(currentRefunds);
            refundList.add(JSON.stringify(refundData));
            targetPaymentTransaction.custom.refunds = refundList;
        })
        return {
            success: true,
            method: 'STRIPE',
            amount: amount,
            transactionId: result.refundId
        };
    } else {
        return {
            success: false,
            method: 'STRIPE',
            error: result.error
        };
    }
}

function refundToPayPal(order, amount, paymentInstrument) {
    Logger.info('Refund Strategy: PAYPAL. Amount: {0}', amount);
    var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');
    return paypalHelper.handlePayPalRefund(order, amount, paymentInstrument);
}

function refundToBreeze(order, amount) {
    Logger.info('Refund Strategy: BREEZE. Amount: {0}', amount);
    // TODO: Implement Breeze Service call
    return { success: false, method: 'BREEZE', amount: amount };
}

// =================================================================
// MAIN PROCESS
// =================================================================

/**
 * Main Entry Point: Handles refund logic.
 * Aggregates all line items with the given SKU and refunds them in one call.
 * * @param {dw.order.Order} order - The order object
 * @param {string} sku - The SKU to refund
 * @param {boolean} cancelledContext - If true, checks if this completes a full order cancellation
 */
function processRefund(order, sku, cancelledContext) {
    var logger = Logger.getLogger('RefundHelper', 'RefundHelper');
    var orderNo = order.getOrderNo();

    try {
        logger.info('Starting refund process for Order: {0}, SKU: {1}, CancelledContext: {2}', orderNo, sku, cancelledContext);

        // 1. Calculate Aggregated Refund Amount
        var amountToRefund = calculateRefundAmount(order, sku, cancelledContext);

        // Round to 2 decimal places to ensure clean currency math
        amountToRefund = parseFloat(amountToRefund.toFixed(2));

        logger.info('Calculated Refund Amount: {0}', amountToRefund);

        if (amountToRefund <= 0) {
            return { success: false, message: 'Calculated refund amount is 0' };
        }

        return refundAcrossInstruments(order, amountToRefund);

    } catch (e) {
        logger.error('Error in processRefund for Order {0}: {1}', orderNo, e.message);
        return {
            success: false,
            message: e.message
        };
    }
}

/**
 * Processes a refund for a specific manual amount (e.g., Exchange Difference).
 * Routes to the correct gateway based on priority.
 * * @param {dw.order.Order} order 
 * @param {number} amountToRefund - The specific amount to refund
 */
function processManualRefund(order, amountToRefund) {
    var logger = Logger.getLogger('RefundHelper', 'RefundHelper');
    var orderNo = order.getOrderNo();

    try {
        logger.info('Starting Manual Refund for Order: {0}, Amount: {1}', orderNo, amountToRefund);

        if (amountToRefund <= 0) {
            return { success: false, message: 'Amount is 0 or negative' };
        }

        return refundAcrossInstruments(order, amountToRefund);

    } catch (e) {
        logger.error('Error in processManualRefund for Order {0}: {1}', orderNo, e.message);
        return { success: false, message: e.message };
    }
}

module.exports = {
    processRefund: processRefund,
    processManualRefund: processManualRefund,
    calculateRefundAmount: calculateRefundAmount
};
