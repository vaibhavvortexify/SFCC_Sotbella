'use strict';

var Site = require('dw/system/Site');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var Order = require('dw/order/Order'); 
var callCancelSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCancelSaleOrder;
var UnicommerceCancelOrderService = require('*/cartridge/services/unicommerceCancelOrderService');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper')
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper'); // <--- ADDED THIS
var ArrayList = require('dw/util/ArrayList');
var Logger = require('dw/system/Logger');
function cancelOrderHelper(body) {
    try {
        var orderId = body.orderId;
        var skuToCancel = body.itemId;
        var reason = body.reason;

        if (!orderId || !skuToCancel) {
            return { success: false, message: "Missing Order ID or Item ID" };
        }

        var order = OrderMgr.getOrder(orderId);

        if (!order) {
            return { success: false, message: "Order not found with ID: " + orderId };
        }
        var productLineItems = order.getAllProductLineItems();
        var itemFound = false;
        var canBeCancelled = false;
        var currentStatus = null;
        var currentStatusDisplayValue = '';

        var iterator = productLineItems.iterator();
        while (iterator.hasNext()) {
            var pli = iterator.next();

            if (pli.productID === skuToCancel) {
                itemFound = true; 
                var status = null; 
                if ('lineItemStatus' in pli.custom && pli.custom.lineItemStatus != null) {
                    status = pli.custom.lineItemStatus.value;
                    currentStatusDisplayValue = pli.custom.lineItemStatus.displayValue;
                }
                currentStatus = status;

                if (status==null || status == 0 || status == 1 || status == 2) {
                    canBeCancelled = true; 
                    break; 
                }
            }
        }

        if (!itemFound) {
            return { success: false, message: "Item with ID " + skuToCancel + " not found in Order " + orderId };
        }

        if (!canBeCancelled) {
            var statusText = currentStatusDisplayValue ? " (" + currentStatusDisplayValue + ")" : "";
            return { 
                success: false, 
                message: "Request Rejected: Item cannot be cancelled because its current status is " + currentStatus + statusText 
            };
        }

        var response = callCancelSaleOrder(orderId, skuToCancel, false,
            function (ordNo, sku, cancelWholeOrder, token) {
                return UnicommerceCancelOrderService.cancelSaleOrder(ordNo, sku, cancelWholeOrder, token);
            }
        );

        if (!response.object.successful) {
            var allErrors = "Unicommerce API Error: ";
            if (response.object.errors && response.object.errors.length > 0) {
                var errorMessages = response.object.errors.map(function (err) { return err.message; });
                allErrors += errorMessages.join(" | ");
            } else {
                allErrors += "Unknown error occurred.";
            }
            return { success: false, message: allErrors };
        }
        var cancelledPLIs = new ArrayList();
        var refundSuccess = false;
        var refundMessage = "";
        try {
            Transaction.wrap(function () {
                if (body.bankDetails) {
                    order.custom.BankName = body.bankDetails.bankName || '';
                    order.custom.AccountNumber = body.bankDetails.accountNumber || '';
                    order.custom.ifscCode = body.bankDetails.ifscCode || '';
                    order.custom.MobileNumber = body.bankDetails.mobileNumber || '';
                }
                var allItemsCancelled = true;
                
                for (var j = 0; j < productLineItems.length; j++) {
                    var targetPli = productLineItems[j];

                    if (targetPli.productID === skuToCancel) {
                        targetPli.custom.lineItemStatus = 3; 
                        targetPli.custom.Reason = reason;
                        targetPli.custom.cancellationDate = new Date();
                        // Add to Cancelled List for Email
                        cancelledPLIs.add(targetPli);
                    }

                    if (targetPli.custom.lineItemStatus != 3) {
                        allItemsCancelled = false;
                    }
                }

                 if (allItemsCancelled) {
                     order.custom.orderStatus = 3;
                 }
                 
            });
            var refundResult = RefundHelper.processRefund(order, skuToCancel, true);
            
            if (refundResult.success) {
                refundSuccess = true;
                refundMessage = "Refund Successful. Amount: " + refundResult.amount;
                emailHelper.sendRefundEmail(order, cancelledPLIs, refundResult.amount, true);
                Logger.info("Cancellation Refund Successful for Order {0}, Item {1}", orderId, skuToCancel);
            } else {
                Logger.warn("Cancellation Refund Failed for Order {0}", orderId);
                refundMessage = "Refund Failed ";
            }

            // STEP C: Update Status to 24 if Refund Succeeded
            if (refundSuccess) {
                Transaction.wrap(function () {
                    for (var k = 0; k < productLineItems.length; k++) {
                        var targetPli = productLineItems[k];
                        if (targetPli.productID === skuToCancel) {
                            // Update status to "CANCELLED AND REFUNDED" (24)
                            targetPli.custom.lineItemStatus = 24; 
                            
                            // Optional: Store refund details if returned by processRefund
                            if (refundResult.transactionId || refundResult.method) {
                                var details = {
                                    method: refundResult.method,
                                    amount: refundResult.amount,
                                    date: new Date().toISOString(),
                                    transactionId: refundResult.transactionId
                                };
                                targetPli.custom.refundDetails = JSON.stringify(details);
                            }
                        }
                    }
                });
                
            }
        } catch (txError) {
            Logger.error("Transaction Failed for Order {0}: {1}", orderId, txError);
            return { success: false, message: "Database Update Failed: " + (txError.message || txError) };
        }
        if (!cancelledPLIs.isEmpty()) {
            try {
                Logger.info("Triggering Cancellation Email for Order {0}, Item {1}", orderId, skuToCancel);
                emailHelper.sendOrderCancellationEmail(order, cancelledPLIs);
            } catch (emailErr) {
                var e=emailErr
                Logger.error("Failed to send cancellation email for order {0}: {1}", orderId, emailErr.message);
                // Do not return false here; the cancellation itself was successful
            }
        }
        return { success: true, message: "Item cancelled successfully. " + refundMessage};

    } catch (e) {
        var msg = e.message || e.toString() || "Unknown Error";
        Logger.error("CancelOrderHelper General Error: {0}", msg);
        return { success: false, message: "General Error: " + msg };
    }
}

/**
 * Controller endpoint
 */
exports.cancel = function () {
    try {
        var requestBody = request.httpParameterMap.requestBodyAsString;

        if (!requestBody) {
             RESTResponseMgr.createError(400, "BadRequest", "Empty Body", "Request body is empty").render();
             return;
        }

        var requestJSON = null;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            RESTResponseMgr.createError(400, "BadRequest", "Invalid JSON", "Invalid JSON format").render();
            return;
        }

        var result = cancelOrderHelper(requestJSON);

        RESTResponseMgr.createSuccess({
            success: result.success,
            message: result.message
        }).render();

    } catch (e) {
        var errorMsg = e.message || e.toString() || "Unexpected Server Error";
        Logger.error("Cancel Controller Critical Error: {0}", errorMsg);
        
        RESTResponseMgr.createError(500, "InternalServerError", "Server Error", errorMsg).render();
    }
};

exports.cancel.public = true;