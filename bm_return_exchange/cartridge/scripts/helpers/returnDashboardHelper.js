'use strict';

var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var System = require('dw/system/System');
var Currency = require('dw/util/Currency');
var StringUtils = require('dw/util/StringUtils');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
var callCreateReversePickup = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateReversePickup;
var callAllocateCourierForReversePickup = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callAllocateCourierForReversePickup;
var UnicommerceReturnServices = require('*/cartridge/services/unicommerceReturnServices');
var callCancelSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCancelSaleOrder;
var UnicommerceCancelOrderService = require('*/cartridge/services/unicommerceCancelOrderService');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
var ArrayList = require('dw/util/ArrayList');
var Transaction = require('dw/system/Transaction');
/**
 * Helper to load JSON preferences safely
 */
function loadJSONPref(prefID) {
    try {
        var orgPrefs = System.getPreferences().getCustom();
        var raw = orgPrefs[prefID];
        if (raw) return JSON.parse(raw);
    } catch (e) {
        Logger.error('Invalid JSON in preference {0}: {1}', prefID, e.message);
    }
    return {};
}

/**
 * Shared mapping for product line item attributes
 */
function mapCommonAttributes(order, pli) {
    var imageUrl = '';
    if (pli.product && pli.product.getImage('large', 0)) {
        imageUrl = pli.product.getImage('large', 0).getAbsURL().toString();
    }

    var finalPrice = RefundHelper.calculateRefundAmount(order, pli.productID, false);

    var paymentMethodName = 'N/A';
    var paymentMethodID = 'N/A';
    var paymentInstruments = order.getPaymentInstruments();
    if (paymentInstruments.length > 0) {
        var pi = paymentInstruments[0];
        // Attempt to get the display name from PaymentMgr, fallback to technical ID
        var method = dw.order.PaymentMgr.getPaymentMethod(pi.getPaymentMethod());
        paymentMethodName = method ? method.getName() : pi.getPaymentMethod();
        paymentMethodID = pi.getPaymentMethod();
    }

    var oAddress = order.getBillingAddress() || order.getShippingAddress();
    var orderAddress = '';

    if (oAddress) {
        var parts = [];
        if (oAddress.getAddress1()) parts.push(oAddress.getAddress1());
        if (oAddress.getAddress2()) parts.push(oAddress.getAddress2());
        if (oAddress.getCity()) parts.push(oAddress.getCity());
        if (oAddress.getStateCode()) parts.push(oAddress.getStateCode());
        if (oAddress.getPostalCode()) parts.push(oAddress.getPostalCode());
        if (oAddress.getCountryCode()) parts.push(oAddress.getCountryCode());
        orderAddress = parts.join(', ');
    }

    var currencyCode = order.getCurrencyCode();
    var currencySymbol = Currency.getCurrency(currencyCode).getSymbol();

    var customerPhone = '';
    var customerEmail = order.customerEmail; // Default to the email on the order object

    if (order.customer && order.customer.profile) {
        customerPhone = order.customer.profile.phoneMobile || order.customer.profile.phoneHome || '';
        customerEmail = order.customer.profile.email || order.customerEmail;
    } else {
        var defaultShipment = order.getDefaultShipment(); // Get the primary shipment
        if (defaultShipment && defaultShipment.getShippingAddress()) {
            customerPhone = defaultShipment.getShippingAddress().getPhone() || '';
        }
    }

    return {
        orderNo: order.orderNo,
        lineItemId: pli.UUID,
        sku: pli.productID,
        productName: pli.productName,
        productImage: imageUrl,
        status: pli.custom.lineItemStatus ? pli.custom.lineItemStatus.value : null,
        displayStatus: pli.custom.lineItemStatus ? pli.custom.lineItemStatus.displayValue : null,
        quantity: pli.quantityValue,
        price: pli.price.available ? pli.price.value : 0,
        singlePrice: pli.basePrice.available ? pli.basePrice.value : 0,
        finalPrice: finalPrice,
        customerName: order.customerName,
        customerPhone: customerPhone,
        orderAddress: orderAddress,
        customerEmail: customerEmail,
        paymentMethod: paymentMethodName,
        paymentMethodID: paymentMethodID,
        creationDate: StringUtils.formatDate(order.creationDate, 'dd-MM-yyyy'),
        description: pli.custom.Description || '',
        mediaLinks: pli.custom.MediaLinks || [],
        reason: pli.custom.Reason || '',
        deliveredDate: pli.custom.deliveredDate ? StringUtils.formatDate(pli.custom.deliveredDate, 'dd-MM-yyyy') : null,
        currencySymbol: currencySymbol,
        returnExchangeRequestDate: pli.custom.returnExchangeRequestDate ? StringUtils.formatDate(pli.custom.returnExchangeRequestDate, 'dd-MM-yyyy') : null,
        BankName: order.custom.BankName || 'Bank Name Not Provided',
        BankMobileNumber: order.custom.MobileNumber || 'Mobile Number Not Provided',
        BankAccountNumber: order.custom.AccountNumber || 'Account Number Not Provided',
        BankifscCode: order.custom.ifscCode || 'IFSC Code Not Provided',
        requestRejectReason: pli.custom.requestRejectReason || '',
        returnInventoryStatus: pli.custom.returnInventoryStatus ? pli.custom.returnInventoryStatus : 'N/A',
    };
}

/**
 * Gets Return Items sorted: RETURNED -> RETURNED AND REFUNDED
 */
function getReturnItemsData(startDate, endDate, tabStatus) {
    var orderStatusMap = loadJSONPref('orderStatusJSON');
    var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');

    var orders = OrderMgr.searchOrders(
        '(status={0} OR status={1}) AND (creationDate >= {2} AND creationDate <= {3}) AND custom.orderStatus = {4}',
        'creationDate desc',
        Order.ORDER_STATUS_NEW, Order.ORDER_STATUS_OPEN, startDate, endDate, orderStatusMap["DELIVERED"]
    );

    // Buckets for sorting
    var returnedBucket = [];
    var refundedBucket = [];
    var otherBucket = [];

    try {
        while (orders.hasNext()) {
            var order = orders.next();
            var productLineItems = order.getAllProductLineItems();

            for (var i = 0; i < productLineItems.length; i++) {
                var pli = productLineItems[i];
                var statusValue = (pli.custom && 'lineItemStatus' in pli.custom) ? pli.custom.lineItemStatus.value : null;
                var itemData = null;

                if (tabStatus === 'returned') {
                    if (statusValue === lineItemStatusMap["RETURNED"]) {
                        returnedBucket.push(mapCommonAttributes(order, pli));
                    } else if (statusValue === lineItemStatusMap["RETURNED AND REFUNDED"]) {
                        refundedBucket.push(mapCommonAttributes(order, pli));
                    }
                } else {
                    // Logic for other tabs (requested, approved, rejected)
                    var isMatch = false;
                    if (tabStatus === 'requested') isMatch = (statusValue === lineItemStatusMap["RETURN REQUESTED"]);
                    else if (tabStatus === 'approved') isMatch = (statusValue === lineItemStatusMap["RETURN ACCEPTED"] || statusValue === lineItemStatusMap["RETURN INITIATED"]);
                    else if (tabStatus === 'rejected') isMatch = (statusValue === lineItemStatusMap["RETURN REJECTED"]);

                    if (isMatch) otherBucket.push(mapCommonAttributes(order, pli));
                }
            }
        }
    } finally { orders.close(); }

    // Combine in specific order: Returned first, then Refunded
    return returnedBucket.concat(refundedBucket).concat(otherBucket);
}

/**
 * Gets Exchange Items sorted: EXCHANGED -> EXCHANGED AND REFUNDED -> EXCHANGED AND CANCELLED
 * Preserves exchange detail fetching and image URL retrieval logic.
 */
function getExchangeItemsData(startDate, endDate, tabStatus) {
    var orderStatusMap = loadJSONPref('orderStatusJSON');
    var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');

    var orders = OrderMgr.searchOrders(
        '(status={0} OR status={1}) AND (creationDate >= {2} AND creationDate <= {3}) AND custom.orderStatus = {4}',
        'creationDate desc',
        Order.ORDER_STATUS_NEW, Order.ORDER_STATUS_OPEN, startDate, endDate, orderStatusMap["DELIVERED"]
    );

    // Buckets for sorting
    var exchangedBucket = [];
    var exRefundedBucket = [];
    var exCancelledBucket = [];
    var otherBucket = [];

    try {
        while (orders.hasNext()) {
            var order = orders.next();
            var productLineItems = order.getAllProductLineItems();

            for (var i = 0; i < productLineItems.length; i++) {
                var pli = productLineItems[i];
                var statusValue = (pli.custom && 'lineItemStatus' in pli.custom) ? pli.custom.lineItemStatus.value : null;

                var isMatch = false;
                var currentBucket = null;

                // 1. Determine Tab Matching and sorting bucket
                if (tabStatus === 'exchanged') {
                    if (statusValue === lineItemStatusMap["EXCHANGED"]) {
                        isMatch = true;
                        currentBucket = exchangedBucket;
                    } else if (statusValue === lineItemStatusMap["EXCHANGED AND REFUNDED"]) {
                        isMatch = true;
                        currentBucket = exRefundedBucket;
                    } else if (statusValue === lineItemStatusMap["EXCHANGED AND CANCELLED"]) {
                        isMatch = true;
                        currentBucket = exCancelledBucket;
                    }
                } else {
                    if (tabStatus === 'requested') isMatch = (statusValue === lineItemStatusMap["EXCHANGE REQUESTED"]);
                    else if (tabStatus === 'approved') isMatch = (statusValue === lineItemStatusMap["EXCHANGE ACCEPTED"] || statusValue === lineItemStatusMap["EXCHANGE INITIATED"]);
                    else if (tabStatus === 'rejected') isMatch = (statusValue === lineItemStatusMap["EXCHANGE REJECTED"]);
                    
                    if (isMatch) currentBucket = otherBucket;
                }

                // 2. If it's a match, process attributes and exchange details
                if (isMatch && currentBucket) {
                    var item = mapCommonAttributes(order, pli);
                    
                    // Add standard exchange attributes
                    item.exchangeOrderId = pli.custom.exchangeOrder || null;
                    item.exchangeAmount = pli.custom.exchangeAmount || 0;
                    item.exchangeItemDetails = null;

                    // Fetch details of the "Exchange For" item (Your working logic)
                    if (item.exchangeOrderId) {
                        var exchangeOrder = OrderMgr.getOrder(item.exchangeOrderId);
                        if (exchangeOrder) {
                            var exPLIs = exchangeOrder.getAllProductLineItems();
                            if (exPLIs.length > 0) {
                                var exPLI = exPLIs[0];
                                var exImageUrl = '';
                                if (exPLI.product) {
                                    var img = exPLI.product.getImage('small', 0) || exPLI.product.getImage('medium', 0) || exPLI.product.getImage('large', 0);
                                    if (img) exImageUrl = img.getAbsURL().toString();
                                }
                                item.exchangeItemDetails = {
                                    name: exPLI.productName,
                                    price: exPLI.price.value,
                                    quantity: exPLI.quantityValue,
                                    sku: exPLI.productID,
                                    image: exImageUrl
                                };
                            }
                        }
                    }
                    
                    // Push to the assigned bucket
                    currentBucket.push(item);
                }
            }
        }
    } finally { 
        orders.close(); 
    }

    // Combine in the specific order requested for the 'exchanged' tab
    return exchangedBucket.concat(exRefundedBucket).concat(exCancelledBucket).concat(otherBucket);
}

/**
 * Updates the Line Item Status in a Transaction
 * And Triggers Reverse Logistics if applicable.
 */
function updateLineItemStatus(orderNo, lineItemId, targetStatusKey) {
    var statusMap = loadJSONPref('lineItemStatusJSON');
    var targetStatusValue = statusMap[targetStatusKey];

    if (!targetStatusValue) {
        return { error: true, message: "Status key not found in preferences" };
    }

    var order = OrderMgr.getOrder(orderNo);
    if (!order) return { error: true, message: "Order not found" };

    var targetPLI = null;

    try {
        // 1. Update Status to ACCEPTED (19 or 23)
        var updateResult = Transaction.wrap(function () {
            var plis = order.getAllProductLineItems().iterator();
            while (plis.hasNext()) {
                var item = plis.next();
                if (item.UUID === lineItemId) {
                    targetPLI = item;
                    break;
                }
            }

            if (targetPLI) {
                targetPLI.custom.lineItemStatus = targetStatusValue;
                return { success: true };
            }
            return { error: true, message: "Line item not found" };
        });

        if (updateResult.error) return updateResult;

        // 2. Trigger Reverse Logistics Flow (Service Calls)
        // Only if status is RETURN ACCEPTED or EXCHANGE ACCEPTED
        if (targetStatusKey === 'RETURN ACCEPTED' || targetStatusKey === 'EXCHANGE ACCEPTED') {

            var logisticsResult = processSingleLineReverseLogistics(order, targetPLI, targetStatusKey);

            if (logisticsResult.error) {
                // Warning: DB Status is ACCEPTED, but Unicommerce call failed.
                return {
                    success: true,
                    warning: "Status updated to Accepted, but Logistics failed: " + logisticsResult.message
                };
            } else {
                // --- NEW LOGIC: Update Flow Flag on Success ---
                Transaction.wrap(function () {
                    order.custom.UpdateFlowFlag = true;
                });
            }
        }

        return { success: true };

    } catch (e) {
        Logger.error("Error updating status: " + e.message);
        return { error: true, message: e.message };
    }
}

/**
 * Updates the Line Item Status to Rejected in a Transaction
 * Handles Return Rejection vs Exchange Rejection (Cancellation flow)
 */
function rejectLineItemRequest(orderNo, lineItemId, isReturn, rejectReason) {
    var statusMap = loadJSONPref('lineItemStatusJSON');
    var targetStatusKey = isReturn ? "RETURN REJECTED" : "EXCHANGE REJECTED";
    var targetStatusValue = statusMap[targetStatusKey];

    if (!targetStatusValue) {
        return { error: true, message: "Rejection status key not found in preferences" };
    }

    var order = OrderMgr.getOrder(orderNo);
    if (!order) return { error: true, message: "Order not found" };

    var targetPLI = null;
    var plis = order.getAllProductLineItems().iterator();
    while (plis.hasNext()) {
        var item = plis.next();
        if (item.UUID === lineItemId) {
            targetPLI = item;
            break;
        }
    }

    if (!targetPLI) return { error: true, message: "Line item not found" };

    try {
        // 1. ALWAYS Update the PLI Status to REJECTED (20 or 22)
        // We do this first so the status is updated regardless of cancellation success
        Transaction.wrap(function () {
            targetPLI.custom.lineItemStatus = targetStatusValue;
            // If it is a Return, we update the flag here
            // Save Reject Reason if provided
            if (rejectReason && rejectReason.trim().length > 0) {
                targetPLI.custom.requestRejectReason = rejectReason.trim();
            }
            if (isReturn) {
                order.custom.UpdateFlowFlag = true;
            }
        });

        // 2. If it's a Return, we are done
        if (isReturn) {
            return { success: true };
        }

        // 3. If it's an Exchange, process cancellation
        var exResult = processExchangeRejected(order, targetPLI);

        // 4. Update Flow Flag ONLY if cancellation process succeeded
        if (exResult.success) {
            Transaction.wrap(function () {
                order.custom.UpdateFlowFlag = true;
            });
            return { success: true };
        } else {
            return {
                success: true,
                warning: "Exchange Rejected locally (Status Updated), but external cancellation failed/skipped."
            };
        }

    } catch (e) {
        Logger.error("Error in rejectLineItemRequest: " + e.message);
        return { error: true, message: e.message };
    }
}
/**
 * Handles Reverse Logistics (Pickup & Courier) for a single PLI.
 * Updates status to INITIATED upon success.
 * @param {Order} order - The Order Object
 * @param {ProductLineItem} pli - The Product Line Item
 * @param {string} triggerStatusKey - "RETURN ACCEPTED" or "EXCHANGE ACCEPTED"
 */
function processSingleLineReverseLogistics(order, pli, triggerStatusKey) {
    var Logger = require('dw/system/Logger').getLogger('ReverseLogistics');
    var sku = pli.getProductID();

    Logger.info('Starting Single Line Reverse Logistics for Order {0} | SKU {1}', order.orderNo, sku);

    try {
        // 1. Extract Data
        var reason = 'Reason' in pli.custom ? pli.custom.Reason : 'Other';
        var customerImageUrl = '';
        if ('MediaLinks' in pli.custom && pli.custom.MediaLinks && pli.custom.MediaLinks.length > 0) {
            customerImageUrl = pli.custom.MediaLinks[0];
        }

        // 2. Service Call: Create Reverse Pickup (Using Wrapper)
        var revPickupRes = callCreateReversePickup(order, sku, reason, customerImageUrl, function (order, returnContext, token) {
            return UnicommerceReturnServices.createReversePickup(order, returnContext, token);
        });

        // 3. Validate Pickup Response
        if (!revPickupRes || !revPickupRes.object || revPickupRes.object.successful === false) {
            var errorMsg = revPickupRes && revPickupRes.errorMessage ? revPickupRes.errorMessage : 'Unknown Error';
            Logger.error('Failed CreateReversePickup for Order {0} SKU {1}: {2}', order.orderNo, sku, errorMsg);
            return { error: true, message: "Create Reverse Pickup Failed: " + errorMsg };
        }

        var reversePickupCode = revPickupRes.object.reversePickupCode;
        if (!reversePickupCode) {
            Logger.error('Reverse Pickup Code not found in response for Order {0} SKU {1}', order.orderNo, sku);
            return { error: true, message: "Reverse Pickup Code Missing" };
        }
        Logger.info('Generated Reverse Pickup Code: {0}', reversePickupCode);

        // 4. Service Call: Allocate Courier (Using Wrapper)
        var allocateCourierRes = callAllocateCourierForReversePickup(reversePickupCode, function (reversePickupCode, token) {
            return UnicommerceReturnServices.allocateCourierForReversePickup(reversePickupCode, token);
        });

        if (!allocateCourierRes || (allocateCourierRes.object && allocateCourierRes.object.successful === false)) {
            Logger.error('Failed Allocate Courier for Code {0}', reversePickupCode);
            return { error: true, message: "Courier Allocation Failed" };
        }

        Logger.info('Successfully Allocated Courier for Order {0}, Code {1}', order.orderNo, reversePickupCode);

        // 5. Determine New Status (INITIATED)
        var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');
        var newStatusValue = null;

        if (triggerStatusKey === 'RETURN ACCEPTED') {
            newStatusValue = lineItemStatusMap["RETURN INITIATED"]; // 25
        } else if (triggerStatusKey === 'EXCHANGE ACCEPTED') {
            newStatusValue = lineItemStatusMap["EXCHANGE INITIATED"]; // 26
        }

        // 6. Update PLI Status in Transaction
        if (newStatusValue) {
            Transaction.wrap(function () {
                pli.custom.lineItemStatus = newStatusValue;
                // Optional: Send email logic here if needed
                Logger.info('Order {0} | SKU {1}: Status updated to {2} (INITIATED)', order.orderNo, sku, newStatusValue);
            });
        }

        return { success: true };

    } catch (e) {
        Logger.error('Exception in processSingleLineReverseLogistics for Order {0} SKU {1}: {2}', order.orderNo, sku, e.message);
        return { error: true, message: e.message };
    }
}
/**
 * Handles logic for Exchange Rejected (Status 22) Specifics.
 * - Attempts to cancel the linked Exchange Order via Service.
 * - NO LONGER UPDATES PLI STATUS HERE (Moved to caller).
 */
function processExchangeRejected(order, pli) {
    var exchangeOrderNo = null;
    var cancellationSuccess = true;

    // 1. Get Exchange Order No
    if ('exchangeOrder' in pli.custom && pli.custom.exchangeOrder) {
        exchangeOrderNo = pli.custom.exchangeOrder;
    }

    if (!exchangeOrderNo) {
        Logger.warn('No exchange order found attached to PLI {0} for Order {1}.', pli.UUID, order.orderNo);
        return { success: false, message: "Linked Exchange Order Not Found" };
    }

    // 2. Cancel the Exchange Order
    var exchangeOrder = OrderMgr.getOrder(exchangeOrderNo);
    if (exchangeOrder) {
        if (exchangeOrder.status.value !== Order.ORDER_STATUS_CANCELLED &&
            exchangeOrder.status.value !== Order.ORDER_STATUS_FAILED) {

            try {
                // A. Call Unicommerce Service
                var apiCallback = function (ordNo, sku, cancelWholeOrder, token) {
                    return UnicommerceCancelOrderService.cancelSaleOrder(ordNo, sku, cancelWholeOrder, token);
                };

                var response = callCancelSaleOrder(exchangeOrderNo, '', true, apiCallback);

                if (response && response.ok && response.object && response.object.successful) {
                    Logger.info('OMS Service Success: Cancelled Exchange Order {0}.', exchangeOrderNo);
                } else {
                    cancellationSuccess = false;
                    var errMsg = response.errorMessage || (response.object ? response.object.message : 'Unknown Error');
                    Logger.error('OMS Service Failed: Could not cancel Exchange Order {0}. Error: {1}', exchangeOrderNo, errMsg);
                }

                // B. Update Local Exchange Order Status (Regardless of API success, usually)
                Transaction.wrap(function () {
                    exchangeOrder.setStatus(Order.ORDER_STATUS_CANCELLED);
                    exchangeOrder.custom.orderStatus = loadJSONPref('orderStatusJSON')["CANCELLED"];
                    Logger.info('Locally Cancelled Linked Exchange Order {0}.', exchangeOrderNo);
                });

            } catch (e) {
                cancellationSuccess = false;
                Logger.error('Exception during Exchange Cancellation for {0}: {1}', exchangeOrderNo, e.message);
            }
        } else {
            Logger.warn('Skipping API Call: Linked Exchange Order {0} is already Cancelled or Failed.', exchangeOrderNo);
        }
    } else {
        Logger.error('Linked Exchange Order {0} object not found in SFCC.', exchangeOrderNo);
        cancellationSuccess = false;
    }

    return { success: cancellationSuccess };
}


/**
 * Credits the customer's wallet directly 
 * @param {dw.order.Order} order - The order object
 * @param {number} amount - The amount to credit
 */
function refundToWallet(order, amount) {
    var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
    Logger.info('Refund Strategy: WALLET. Amount: {0}', amount);

    var walletHelper = require('*/cartridge/scripts/helpers/walletHelper');

    // 1. Prepare Data
    var customerEmail = order.getCustomerEmail();
    var orderNo = order.getOrderNo();

    var type = 'refund';
    var description = 'Refund for Order #' + orderNo;
    var remarks = 'Refund processed for Order #' + orderNo;
    var referenceId = orderNo;

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
        return {
            success: true,
            method: 'WALLET',
            amount: amount,
            transactionId: referenceId
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
/**
 * Updates a specific PLI status after a successful refund.
 * - If isReturn = true  -> "RETURNED AND REFUNDED" (27)
 * - If isReturn = false -> "EXCHANGED AND REFUNDED" (28)
 */
function updateStatusToRefunded(order, pli, isReturn, refundAmount, refundDetails) {
    var Transaction = require('dw/system/Transaction');
    var statusMap = loadJSONPref('lineItemStatusJSON');

    var targetStatusKey = isReturn ? "RETURNED AND REFUNDED" : "EXCHANGED AND REFUNDED";
    var targetStatusValue = statusMap[targetStatusKey];

    if (!targetStatusValue) {
        return { success: false, message: "Status '" + targetStatusKey + "' not found in preferences." };
    }

    try {
        Transaction.wrap(function () {
            pli.custom.lineItemStatus = targetStatusValue;
            order.custom.UpdateFlowFlag = true;
            // --- STORE REFUND DETAILS JSON ---
            if (refundDetails) {
                // Add timestamp if missing
                if (!refundDetails.date) {
                    refundDetails.date = new Date().toISOString();
                }
                pli.custom.refundDetails = JSON.stringify(refundDetails);
            }
        });
        if (refundAmount > 0) {
            try {
                var plisCollection = new ArrayList();
                plisCollection.add(pli);
                // cancelledContext = false because this is a standard refund, not a cancellation
                emailHelper.sendRefundEmail(order, plisCollection, refundAmount, false);
            } catch (emailErr) {
                var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
                Logger.error("Failed to send Refund Email: ");
            }
        }
        return { success: true };
    } catch (e) {
        var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
        Logger.error("Error updating status to Refunded: " + e.message);
        return { success: false, message: e.message };
    }
}

/**
 * Updates a specific PLI status to "EXCHANGED AND CANCELLED" (29).
 * Used when refunding a Rejected Exchange.
 */
function updateStatusToExchangeCancelled(order, pli, refundAmount, refundDetails) {
    var Transaction = require('dw/system/Transaction');
    var statusMap = loadJSONPref('lineItemStatusJSON');
    var targetStatusValue = statusMap["EXCHANGED AND CANCELLED"]; // Should be 29

    if (!targetStatusValue) {
        return { success: false, message: "Status 'EXCHANGED AND CANCELLED' not found in preferences." };
    }

    try {
        Transaction.wrap(function () {
            pli.custom.lineItemStatus = targetStatusValue;
            order.custom.UpdateFlowFlag = true;
            if (refundDetails) {
                if (!refundDetails.date) {
                    refundDetails.date = new Date().toISOString();
                }
                pli.custom.refundDetails = JSON.stringify(refundDetails);
            }
        });
        if (refundAmount > 0) {
            try {
                var plisCollection = new ArrayList();
                plisCollection.add(pli);
                // cancelledContext = true because this is a cancellation scenario
                emailHelper.sendRefundEmail(order, plisCollection, refundAmount, true);
            } catch (emailErr) {
                var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
                Logger.error("Failed to send Exchange Cancelled Refund Email: ");
            }
        }
        return { success: true };
    } catch (e) {
        var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
        Logger.error("Error updating status to Exchanged and Cancelled: " + e.message);
        return { success: false, message: e.message };
    }
}
// @ts-ignore
module.exports = {
    getReturnItemsData: getReturnItemsData,
    getExchangeItemsData: getExchangeItemsData,
    loadJSONPref: loadJSONPref,
    updateLineItemStatus: updateLineItemStatus,
    rejectLineItemRequest: rejectLineItemRequest,
    updateStatusToRefunded: updateStatusToRefunded,
    refundToWallet: refundToWallet,
    updateStatusToExchangeCancelled: updateStatusToExchangeCancelled
}