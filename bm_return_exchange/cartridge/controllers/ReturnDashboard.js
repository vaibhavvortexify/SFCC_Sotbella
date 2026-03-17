'use strict';

var Logger = require('dw/system/Logger').getLogger('ReturnDashboard');
var StringUtils = require('dw/util/StringUtils');
var ISML = require('dw/template/ISML');
var responseUtil = require('*/cartridge/scripts/util/responseUtil');
var returnDashboardHelper = require('*/cartridge/scripts/helpers/returnDashboardHelper');
var Site = require('dw/system/Site');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
var OrderMgr = require('dw/order/OrderMgr');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
var ArrayList = require('dw/util/ArrayList');

function Show() {
    var params = request.httpParameterMap;
    var Calendar = require('dw/util/Calendar');

    // 1. Handle Start Date (Default 30 days ago)
    var startCal = new Calendar();
    if (!params.startDate.empty) {
        startCal.setTime(new Date(params.startDate));
    } else {
        startCal.add(Calendar.DAY_OF_YEAR, -30);
    }
    var startDate = startCal.getTime();

    // 2. Handle End Date (Default Today)
    var endCal = new Calendar();
    if (!params.endDate.empty) {
        endCal.setTime(new Date(params.endDate));
    }
    var endDate = endCal.getTime();

    // 3. Handle End Date + 1 (For the search query range)
    var searchEndCal = new Calendar(endDate);
    searchEndCal.add(Calendar.DAY_OF_YEAR, 1);
    var endDatePlusOne = searchEndCal.getTime();

    // Formatting for the UI (ISML inputs)
    var formattedStart = StringUtils.formatDate(startDate, 'yyyy-MM-dd');
    var formattedEnd = StringUtils.formatDate(endDate, 'yyyy-MM-dd');

    var isReturn = params.isReturn.booleanValue !== false;
    var tabStatus = params.tabStatus.stringValue || 'requested';

    // --- Get Allowed Payment Methods --- 
    var allowedPaymentMethodsRaw = Site.getCurrent().getCustomPreferenceValue('allowedPaymentMethods');
    var allowedPaymentMethods = [];
    try {
        if (allowedPaymentMethodsRaw) {
            allowedPaymentMethods = JSON.parse(allowedPaymentMethodsRaw);
        }
    } catch (e) {
        Logger.error('Invalid JSON in allowedPaymentMethods preference: ' + e.message);
    }

    // Use endDatePlusOne for the actual database search
    var items = isReturn
        ? returnDashboardHelper.getReturnItemsData(startDate, endDatePlusOne, tabStatus)
        : returnDashboardHelper.getExchangeItemsData(startDate, endDatePlusOne, tabStatus);

    if (params.format.stringValue === 'ajax') {
        responseUtil.renderJSON({
            items: items,
            startDate: formattedStart,
            endDate: formattedEnd
        });
        return;
    }

    ISML.renderTemplate('dashboard', {
        title: isReturn ? 'Return Management' : 'Exchange Management',
        items: items,
        isReturn: isReturn,
        tabStatus: tabStatus,
        startDate: formattedStart,
        endDate: formattedEnd,
        allowedPaymentMethods: allowedPaymentMethods
    });
}

function AcceptRequest() {
    var params = request.httpParameterMap;
    var orderNo = params.orderNo.stringValue;
    var lineItemId = params.lineItemId.stringValue;
    var isReturn = params.isReturn.booleanValue;

    // Determine the status key based on the module
    var targetStatusKey = isReturn ? "RETURN ACCEPTED" : "EXCHANGE ACCEPTED";

    if (!orderNo || !lineItemId) {
        responseUtil.renderJSON({ error: true, message: "Missing required parameters" });
        return;
    }

    var result = returnDashboardHelper.updateLineItemStatus(orderNo, lineItemId, targetStatusKey);
    if (isReturn) {
        try {
            var order = OrderMgr.getOrder(orderNo);
            if (order) {
                var targetPLI = null;
                var allLineItems = order.getAllProductLineItems();

                // Find the specific PLI
                for (var i = 0; i < allLineItems.length; i++) {
                    if (allLineItems[i].UUID === lineItemId) {
                        targetPLI = allLineItems[i];
                        break;
                    }
                }

                if (targetPLI) {
                    var plisCollection = new ArrayList();
                    plisCollection.add(targetPLI);
                    // Send Email
                    emailHelper.sendReturnAcceptedEmail(order, plisCollection);
                }
            }
        } catch (e) {
            Logger.error("Failed to send Return Accepted email for Order {0}: {1}", orderNo, e.message);
        }
    }

    responseUtil.renderJSON(result);
}

function RejectRequest() {
    var params = request.httpParameterMap;
    var orderNo = params.orderNo.stringValue;
    var lineItemId = params.lineItemId.stringValue;
    var isReturn = params.isReturn.booleanValue;
    var rejectReason = params.rejectReason.stringValue || "";

    if (!orderNo || !lineItemId) {
        responseUtil.renderJSON({ error: true, message: "Missing required parameters" });
        return;
    }

    var result = returnDashboardHelper.rejectLineItemRequest(orderNo, lineItemId, isReturn,rejectReason);

    if (isReturn) {
        try {
            var order = OrderMgr.getOrder(orderNo);
            if (order) {
                var targetPLI = null;
                var allLineItems = order.getAllProductLineItems();
                
                // Find the specific PLI
                for (var i = 0; i < allLineItems.length; i++) {
                    if (allLineItems[i].UUID === lineItemId) {
                        targetPLI = allLineItems[i];
                        break;
                    }
                }

                if (targetPLI) {
                    var plisCollection = new ArrayList();
                    plisCollection.add(targetPLI);
                    
                    // Send Email
                    emailHelper.sendReturnRejectedEmail(order, plisCollection);
                }
            }
        } catch (e) {
            Logger.error("Failed to send Return Rejected email for Order {0}: {1}", orderNo, e.message);
            // We do not fail the request here, as the status update was successful
        }
    }

    responseUtil.renderJSON(result);
}

/**
 * Handles the Refund Logic.
 * - Validates Order, PLI, and Amount.
 * - Splits flow based on isReturn flag.
 */
function RefundLineItem() {
    var params = request.httpParameterMap;

    var orderNo = params.orderNo.stringValue;
    var pliUUID = params.lineItemId.stringValue;
    var isReturn = params.isReturn.booleanValue;
    var paymentMethod = params.paymentMethod.stringValue; // 'ORIGINAL', 'WALLET', 'BANK_TRANSFER'
    var amountToRefund = params.amount.doubleValue;

    // 1. Basic Parameter Validation
    if (!orderNo || !pliUUID || !paymentMethod) {
        responseUtil.renderJSON({ success: false, message: "Missing required parameters." });
        return;
    }

    if (amountToRefund === null || amountToRefund < 0) {
        responseUtil.renderJSON({ success: false, message: "Invalid or missing refund amount." });
        return;
    }

    var order = OrderMgr.getOrder(orderNo);
    if (!order) {
        responseUtil.renderJSON({ success: false, message: "Order not found." });
        return;
    }

    // 2. Get Target PLI
    var targetPLI = null;
    var allLineItems = order.getAllProductLineItems();
    for (var i = 0; i < allLineItems.length; i++) {
        if (allLineItems[i].UUID === pliUUID) {
            targetPLI = allLineItems[i];
            break;
        }
    }

    if (!targetPLI) {
        responseUtil.renderJSON({ success: false, message: "Line Item not found." });
        return;
    }

    var statusMap = returnDashboardHelper.loadJSONPref('lineItemStatusJSON');
    var currentStatus = targetPLI.custom.lineItemStatus ? targetPLI.custom.lineItemStatus.value : null;
    var result = { success: false, message: "Unknown error" };

    try {
        // --- SPLIT LOGIC BASED ON MODULE ---
        if (isReturn) {
            // ===================================================
            // RETURN REFUND LOGIC
            // ===================================================

            // A. Validate Status (Must be 'RETURNED')
            var returnedStatus = statusMap["RETURNED"];
            if (currentStatus !== returnedStatus) {
                responseUtil.renderJSON({ success: false, message: "Action Denied: Item status is not 'RETURNED'." });
                return;
            }

            // B. Process Payment Methods
            if (amountToRefund === 0) {
                var zeroDetails = { method: 'NONE', amount: 0, reason: 'Zero amount refund' };
                var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, true,amountToRefund,zeroDetails); // true = Return flow
                result = statusRes.success
                    ? { success: true, message: "Amount is 0. Status Updated to Returned & Refunded." }
                    : { success: false, message: "Amount is 0, but Status Update Failed: " + statusRes.message };
            }
            else {
                if (paymentMethod === 'ORIGINAL') {
                    var refundRes = RefundHelper.processManualRefund(order, amountToRefund);

                    if (refundRes.success) {
                        var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, true,amountToRefund,refundRes);
                        if (statusRes.success) {
                            result = { success: true, message: "Refunded to Original Method and Status Updated." };
                        } else {
                            result = { success: true, message: "Refund successful, but Status Update Failed: " + statusRes.message };
                        }
                    } else {
                        result = { success: false, message: "Refund Failed: " + refundRes.message };
                    }

                } else if (paymentMethod === 'WALLET') {
                    var walletRes = returnDashboardHelper.refundToWallet(order, amountToRefund);

                    if (walletRes.success) {
                        var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, true,amountToRefund,walletRes);
                        if (statusRes.success) {
                            result = { success: true, message: "Credited to Wallet and Status Updated." };
                        } else {
                            result = { success: true, message: "Wallet Credited, but Status Update Failed: " + statusRes.message };
                        }
                    } else {
                        result = { success: false, message: "Wallet Refund Failed: " + walletRes.error };
                    }

                } else if (paymentMethod === 'BANK_TRANSFER') {
                    // Bank Transfer is manual/offline, just update status
                    var bankDetails = {
                        method: 'BANK_TRANSFER',
                        amount: amountToRefund
                    };
                    var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, true,amountToRefund,bankDetails);
                    if (statusRes.success) {
                        result = { success: true, message: "Marked as Refunded via Bank Transfer." };
                    } else {
                        result = { success: false, message: "Status Update Failed: " + statusRes.message };
                    }

                } else {
                    result = { success: false, message: "Invalid Payment Method Selected." };
                }
            }

        } else {
            // ===================================================
            // EXCHANGE REFUND LOGIC (To be implemented)
            // ===================================================
            var exchangedStatus = statusMap["EXCHANGED"]; // 16
            var exchangeRejectedStatus = statusMap["EXCHANGE REJECTED"]; // 22
            if (currentStatus === exchangedStatus) {
                if (amountToRefund === 0) {
                    var zeroDetails = { method: 'NONE', amount: 0, reason: 'Zero amount refund' };
                    var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, false,amountToRefund,zeroDetails); // false = Exchange flow
                    result = statusRes.success
                        ? { success: true, message: "Amount is 0. Status Updated to Exchanged & Refunded." }
                        : { success: false, message: "Amount is 0, but Status Update Failed: " + statusRes.message };
                }
                else {
                    if (paymentMethod === 'ORIGINAL') {
                        var refundRes = RefundHelper.processManualRefund(order, amountToRefund);
                        if (refundRes.success) {
                            var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, false,amountToRefund,refundRes);
                            result = statusRes.success ? { success: true, message: "Exchange Refunded & Updated." } : { success: true, message: "Refunded, but Status Update Failed." };
                        } else {
                            result = { success: false, message: "Refund Failed: " + refundRes.message };
                        }
                    } else if (paymentMethod === 'WALLET') {
                        var walletRes = returnDashboardHelper.refundToWallet(order, amountToRefund);
                        if (walletRes.success) {
                            var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, false,amountToRefund,walletRes);
                            result = statusRes.success ? { success: true, message: "Wallet Credited & Updated." } : { success: true, message: "Wallet Credited, but Status Update Failed." };
                        } else {
                            result = { success: false, message: "Wallet Refund Failed: " + walletRes.error };
                        }
                    } else if (paymentMethod === 'BANK_TRANSFER') {
                         var bankDetails = {
                        method: 'BANK_TRANSFER',
                        amount: amountToRefund
                    };
                        var statusRes = returnDashboardHelper.updateStatusToRefunded(order, targetPLI, false,amountToRefund,bankDetails);
                        result = statusRes.success ? { success: true, message: "Marked as Bank Transfer Refund." } : { success: false, message: "Status Update Failed: " + statusRes.message };
                    } else {
                        result = { success: false, message: "Invalid Payment Method." };
                    }
                }
            } else if (currentStatus === exchangeRejectedStatus) {
                if (amountToRefund === 0) {
                    var zeroDetails = { method: 'NONE', amount: 0, reason: 'Zero amount refund' };
                    var statusRes = returnDashboardHelper.updateStatusToExchangeCancelled(order, targetPLI,amountToRefund,zeroDetails);
                    result = statusRes.success
                        ? { success: true, message: "Amount is 0. Status Updated to Exchanged & Cancelled." }
                        : { success: false, message: "Amount is 0, but Status Update Failed: " + statusRes.message };
                }
                else {
                    var exchangeOrderNo = targetPLI.custom.exchangeOrder;
                    var exchangeOrder = null;

                    if (exchangeOrderNo) {
                        exchangeOrder = OrderMgr.getOrder(exchangeOrderNo);
                    }

                    if (!exchangeOrder && (paymentMethod === 'ORIGINAL' || paymentMethod === 'WALLET')) {
                        responseUtil.renderJSON({ success: false, message: "Linked Exchange Order not found. Cannot process refund." });
                        return;
                    }

                    if (paymentMethod === 'ORIGINAL') {
                        // Pass EXCHANGE ORDER for refund
                        var refundRes = RefundHelper.processManualRefund(exchangeOrder, amountToRefund);

                        if (refundRes.success) {
                            // Pass ORIGINAL ORDER for status update
                            var statusRes = returnDashboardHelper.updateStatusToExchangeCancelled(order, targetPLI,amountToRefund,refundRes);
                            result = statusRes.success ? { success: true, message: "Refunded & Status Updated to Cancelled." } : { success: true, message: "Refunded, but Status Update Failed." };
                        } else {
                            result = { success: false, message: "Refund Failed: " + refundRes.message };
                        }

                    } else if (paymentMethod === 'WALLET') {
                        // Pass EXCHANGE ORDER for refund
                        var walletRes = returnDashboardHelper.refundToWallet(exchangeOrder, amountToRefund);

                        if (walletRes.success) {
                            // Pass ORIGINAL ORDER for status update
                            var statusRes = returnDashboardHelper.updateStatusToExchangeCancelled(order, targetPLI,amountToRefund,walletRes);
                            result = statusRes.success ? { success: true, message: "Wallet Credited & Status Updated to Cancelled." } : { success: true, message: "Wallet Credited, but Status Update Failed." };
                        } else {
                            result = { success: false, message: "Wallet Refund Failed: " + walletRes.error };
                        }

                    } else if (paymentMethod === 'BANK_TRANSFER') {
                        // No refund call, just update status on ORIGINAL ORDER
                        var bankDetails = { method: 'BANK_TRANSFER', amount: amountToRefund };
                        var statusRes = returnDashboardHelper.updateStatusToExchangeCancelled(order, targetPLI,amountToRefund,bankDetails);
                        result = statusRes.success ? { success: true, message: "Marked as Cancelled (Bank Transfer)." } : { success: false, message: "Status Update Failed: " + statusRes.message };
                    } else {
                        result = { success: false, message: "Invalid Payment Method." };
                    }
                }
            }
            else {
                responseUtil.renderJSON({ success: false, message: "Action Denied: Status is not EXCHANGED or EXCHANGE REJECTED." });
                return;
            }
        }

    } catch (e) {
        Logger.error("Exception in RefundLineItem: " + e.message);
        result = { success: false, message: "System Error: " + e.message };
    }

    responseUtil.renderJSON(result);
}

/**
 * Controller Route: ReturnDashboard-DownloadCSV
 */
function DownloadCSV() {
    var params = request.httpParameterMap;
    var csvDownloadHelper = require('*/cartridge/scripts/helpers/csvDownloadHelper');
    
    var csvDataRaw = params.csvData.stringValue;
    if (!csvDataRaw) {
        response.setStatus(500);
        return;
    }

    var dataArray = JSON.parse(csvDataRaw);

    // Set Response Headers
    response.setContentType('text/csv');
    // Note: We don't strictly need Content-Disposition here because JS will handle the filename
    
    csvDownloadHelper.generateGenericCSV(dataArray, response.writer);
}

// @ts-ignore
exports.Show = Show;
exports.Show.public = true;
// @ts-ignore
exports.AcceptRequest = AcceptRequest;
exports.AcceptRequest.public = true;
// @ts-ignore
exports.RejectRequest = RejectRequest;
exports.RejectRequest.public = true;
// @ts-ignore
exports.RefundLineItem = RefundLineItem;
exports.RefundLineItem.public = true;
// @ts-ignore
exports.DownloadCSV = DownloadCSV;
exports.DownloadCSV.public = true;