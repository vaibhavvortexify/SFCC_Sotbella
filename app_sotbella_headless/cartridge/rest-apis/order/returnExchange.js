'use strict';

var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var OrderMgr = require('dw/order/OrderMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var returnExchangeHelper = require('*/cartridge/scripts/helpers/returnExchangeHelper');


function validateItemInOrder(order, itemId) {
    if (!order || !itemId) { return false; }
    var productLineItems = order.getProductLineItems();
    var iterator = productLineItems.iterator();
    while (iterator.hasNext()) {
        var pli = iterator.next();
        if (pli.productID === itemId) { return true; }
    }
    return false;
}

/**
 * Main Controller Endpoint
 */
exports.returnExchange = function () {
    var requestBody = request.httpParameterMap.requestBodyAsString;
    var body;
    var result = {};

    // 1. Safe JSON Parsing
    try {
        body = JSON.parse(requestBody);
    } catch (e) {
        return RESTResponseMgr.createError(
            400,
            'MalformedJSON',
            'Invalid JSON Format',
            'The request body could not be parsed as JSON.'
        ).render();
    }

    // Cleanup old baskets (Optional maintenance)
    returnExchangeHelper.cleanupTempBaskets();

    try {
        var actionType = body.actionType;
        var orderNo = body.orderId;

        // 2. Validate Order Exists
        var order = OrderMgr.getOrder(orderNo);
        if (!order) {
            return RESTResponseMgr.createError(
                404,
                'OrderNotFound',
                'Order Not Found',
                'The order with ID ' + orderNo + ' could not be found.'
            ).render();
        }

        var isItemValid = validateItemInOrder(order, body.itemId);
        if (!isItemValid) {
            return RESTResponseMgr.createError(
                400,
                'ItemNotFound',
                'Invalid Item ID',
                'The item with ID ' + body.itemId + ' was not found in Order ' + orderNo
            ).render();
        }

        var productToCheck = ProductMgr.getProduct(body.itemId);

        // 1. Check if product exists in catalog
        if (!productToCheck) {
             return RESTResponseMgr.createError(
                400,
                'ProductNotFound',
                'Product Not Found',
                'The product ' + body.itemId + ' no longer exists in the catalog.'
            ).render();
        }

        // 2. Check the Custom Attribute (Default to false if null/undefined)
        if (productToCheck.custom.allowReturnExchange !== true) {
            return RESTResponseMgr.createError(
                400,
                'ProductNotEligible',
                'Return/Exchange Rejected',
                'This product (' + body.itemId + ') is not eligible for returns or exchanges.'
            ).render();
        }

        // 3. Validate Deadline & Delivery Status (Gatekeeper)
        var validation = returnExchangeHelper.validateRequestWindow(order, actionType, body.itemId);
        if (!validation.allowed) {
            // Default Error Info
            var errorCode = 'EligibilityFailed';
            var errorTitle = 'Return/Exchange Request Rejected';

            // Dynamically set specific error codes based on the helper's message
            if (validation.message && validation.message.indexOf('not delivered') !== -1) {
                errorCode = 'ProductNotDelivered';
                errorTitle = 'Product Not Delivered Yet';
            } else if (validation.message && validation.message.indexOf('deadline') !== -1) {
                errorCode = 'DeadlineExceeded';
                errorTitle = 'Return/Exchange Deadline Exceeded';
            }

            return RESTResponseMgr.createError(
                400,        // statusCode
                errorCode,  // type (e.g. 'ProductNotDelivered')
                errorTitle, // title
                validation.message // detail
            ).render();
        }

        var statusValidation = returnExchangeHelper.validateItemStatus(order, body.itemId);
        if (!statusValidation.allowed) {
            return RESTResponseMgr.createError(
                400,
                'RequestAlreadyExists',
                'Request Rejected',
                statusValidation.message
            ).render();
        }

        // 4. Route to Helper Logic
        switch (actionType) {
            case 'RETURN':
                result = returnExchangeHelper.processReturn(order, body);
                break;

            case 'EXCHANGE-SAME':
                result = returnExchangeHelper.processExchangeSame(order, body);
                break;

            case 'EXCHANGE-DIFFERENT':
                result = returnExchangeHelper.processExchangeDifferent(order, body);
                break;

            default:
                return RESTResponseMgr.createError(
                    400,
                    'InvalidAction',
                    'Invalid Action Type',
                    'The actionType ' + actionType + ' is not supported.'
                ).render();
        }

        // 5. Check Helper Result
        // If the helper reported an error (logic failure, calculation issue, etc.)
        if (result.error || result.success === false) {
            return RESTResponseMgr.createError(
                400,
                'ProcessingError',
                result.message || 'Bad Request',
                // If helper returns detailed error info, use it, else generic
                result.details && result.details.error ? result.details.error : result.message
            ).render();
        }

    } catch (e) {
        // 6. Catch Unexpected System Errors
        return RESTResponseMgr.createError(
            500,
            'InternalServerError',
            'An internal system error occurred',
            e.message
        ).render();
    }

    // 7. Render Success Response
    // Only reachable if no errors occurred above
    RESTResponseMgr.createSuccess({
        success: true,
        message: result.message || "Action processed successfully",
        result: result
    }).render();
};

exports.returnExchange.public = true;