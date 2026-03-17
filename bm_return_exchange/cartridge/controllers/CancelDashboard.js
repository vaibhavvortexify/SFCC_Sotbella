'use strict';

var Logger = require('dw/system/Logger').getLogger('CancelDashboard');
var StringUtils = require('dw/util/StringUtils');
var ISML = require('dw/template/ISML');
var responseUtil = require('*/cartridge/scripts/util/responseUtil');
var cancelDashboardHelper = require('*/cartridge/scripts/helpers/cancelDashboardHelper');
var Site = require('dw/system/Site');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
var OrderMgr = require('dw/order/OrderMgr');

function Show() {
    var params = request.httpParameterMap;
    var Calendar = require('dw/util/Calendar');

    // 1. Date Logic
    var startCal = new Calendar();
    if (!params.startDate.empty) {
        startCal.setTime(new Date(params.startDate));
    } else {
        startCal.add(Calendar.DAY_OF_YEAR, -30);
    }
    var startDate = startCal.getTime();

    var endCal = new Calendar();
    if (!params.endDate.empty) {
        endCal.setTime(new Date(params.endDate));
    }
    var endDate = endCal.getTime();

    var searchEndCal = new Calendar(endDate);
    searchEndCal.add(Calendar.DAY_OF_YEAR, 1);
    var endDatePlusOne = searchEndCal.getTime();

    var formattedStart = StringUtils.formatDate(startDate, 'yyyy-MM-dd');
    var formattedEnd = StringUtils.formatDate(endDate, 'yyyy-MM-dd');

    var tabStatus = params.tabStatus.stringValue || 'cancelled'; 

    // 2. Load Preferences
    var allowedPaymentMethodsRaw = Site.getCurrent().getCustomPreferenceValue('allowedPaymentMethods');
    var allowedPaymentMethods = [];
    try {
        if (allowedPaymentMethodsRaw) allowedPaymentMethods = JSON.parse(allowedPaymentMethodsRaw);
    } catch (e) {
        Logger.error('Invalid JSON in allowedPaymentMethods: ' + e.message);
    }

    // 3. Fetch Data
    var items = cancelDashboardHelper.getCancelledItemsData(startDate, endDatePlusOne, tabStatus);

    if (params.format.stringValue === 'ajax') {
        responseUtil.renderJSON({
            items: items,
            startDate: formattedStart,
            endDate: formattedEnd
        });
        return;
    }

    ISML.renderTemplate('cancel/cancelDashboard', {
        title: 'Cancellation Management',
        items: items,
        tabStatus: tabStatus,
        startDate: formattedStart,
        endDate: formattedEnd,
        allowedPaymentMethods: allowedPaymentMethods
    });
}

function RefundCancelledItem() {
    var params = request.httpParameterMap;
    var orderNo = params.orderNo.stringValue;
    var pliUUID = params.lineItemId.stringValue;
    var paymentMethod = params.paymentMethod.stringValue;
    var amountToRefund = params.amount.doubleValue;

    if (!orderNo || !pliUUID || !paymentMethod || amountToRefund === null) {
        responseUtil.renderJSON({ success: false, message: "Missing required parameters." });
        return;
    }

    var order = OrderMgr.getOrder(orderNo);
    var targetPLI = null;
    var allLineItems = order.getAllProductLineItems();
    for (var i = 0; i < allLineItems.length; i++) {
        if (allLineItems[i].UUID === pliUUID) {
            targetPLI = allLineItems[i];
            break;
        }
    }

    var result = { success: false, message: "Unknown error" };

    try {
        if (paymentMethod === 'ORIGINAL') {
            var refundRes = RefundHelper.processManualRefund(order, amountToRefund);
            if (refundRes.success) {
                result = cancelDashboardHelper.updateStatusToCancelledRefunded(order, targetPLI, amountToRefund, refundRes);
            } else {
                result = { success: false, message: "Gateway Refund Failed: " + refundRes.message };
            }
        } else if (paymentMethod === 'WALLET') {
            var walletRes = cancelDashboardHelper.refundToWallet(order, amountToRefund);
            if (walletRes.success) {
                result = cancelDashboardHelper.updateStatusToCancelledRefunded(order, targetPLI, amountToRefund, walletRes);
            } else {
                result = { success: false, message: "Wallet Credit Failed" };
            }
        } else if (paymentMethod === 'BANK_TRANSFER') {
            result = cancelDashboardHelper.updateStatusToCancelledRefunded(order, targetPLI, amountToRefund, { method: 'BANK_TRANSFER' });
        }
    } catch (e) {
        Logger.error("Exception in RefundCancelledItem: " + e.message);
        result = { success: false, message: e.message };
    }

    responseUtil.renderJSON(result);
}

/**
 * Route: CancelDashboard-DownloadCSV
 */
function DownloadCSV() {
    var params = request.httpParameterMap;
    var csvDownloadHelper = require('*/cartridge/scripts/helpers/csvDownloadHelper');
    
    var csvDataRaw = params.csvData.stringValue;
    var dataArray = JSON.parse(csvDataRaw);

    // Force content type to binary/octet-stream if CSV is being treated as plain text
    response.setContentType('application/octet-stream'); 
    response.addHttpHeader('Content-Disposition', 'attachment; filename=export.csv');

    csvDownloadHelper.generateGenericCSV(dataArray, response.writer);
}


exports.Show = Show;
exports.Show.public = true;
exports.RefundCancelledItem = RefundCancelledItem;
exports.RefundCancelledItem.public = true;
exports.DownloadCSV = DownloadCSV;
exports.DownloadCSV.public = true;