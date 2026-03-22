'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');

var paypalHelper = require('*/cartridge/scripts/helpers/paypalHelper');

function resolveAuthorizedOrder(orderNo, orderToken) {
    var order = orderToken ? OrderMgr.getOrder(orderNo, orderToken) : OrderMgr.getOrder(orderNo);

    if (!order) {
        return {
            success: false,
            statusCode: 404,
            type: 'NotFound',
            message: 'Order not found'
        };
    }

    if (orderToken) {
        return { success: true, order: order };
    }

    if (!customer.isAuthenticated()) {
        return {
            success: false,
            statusCode: 401,
            type: 'Unauthorized',
            message: 'Order token is required for guest access'
        };
    }

    if (order.getCustomerNo() !== customer.getProfile().getCustomerNo()) {
        return {
            success: false,
            statusCode: 403,
            type: 'Forbidden',
            message: 'You are not authorized to access this order'
        };
    }

    return { success: true, order: order };
}

exports.getPayPalOrderData = function () {
    try {
        var requestBody = request.httpParameterMap.requestBodyAsString;
        if (!requestBody) {
            return { error: true, statusCode: 400, type: 'BadRequest', message: 'Request body is required' };
        }

        var body;
        try {
            body = JSON.parse(requestBody);
        } catch (e) {
            return { error: true, statusCode: 400, type: 'BadRequest', message: 'Invalid JSON format' };
        }

        if (!body.orderNo) {
            return { error: true, statusCode: 400, type: 'BadRequest', message: 'orderNo is required' };
        }

        var orderResult = resolveAuthorizedOrder(body.orderNo, body.orderToken);
        if (!orderResult.success) {
            return {
                error: true,
                statusCode: orderResult.statusCode,
                type: orderResult.type,
                message: orderResult.message
            };
        }

        var order = orderResult.order;
        var paymentInstrument = paypalHelper.getPayPalPaymentInstrument(order);
        if (!paymentInstrument) {
            return {
                error: true,
                statusCode: 404,
                type: 'NotFound',
                message: 'No PayPal payment instrument found for this order'
            };
        }

        return {
            success: true,
            orderNo: order.orderNo,
            orderToken: order.orderToken,
            currencyCode: order.getCurrencyCode(),
            //currencyCode: 'USD',
            orderAmount: order.totalGrossPrice.value,
            paypalOrderId: paymentInstrument.custom.paypal_order_id || '',
            paypalOrderStatus: paymentInstrument.custom.paypal_order_status || '',
            paypalCaptureId: paymentInstrument.custom.paypal_capture_id || '',
            paypalCaptureStatus: paymentInstrument.custom.paypal_capture_status || ''
        };
    } catch (e) {
        Logger.error('Error in getPayPalOrderData: {0}', e.message);
        return {
            error: true,
            statusCode: 500,
            type: 'InternalServerError',
            message: e.message
        };
    }
};

exports.getPayPalOrder = function () {
    var result = exports.getPayPalOrderData();
    if (result.error) {
        RESTResponseMgr.createError(result.statusCode, result.type, result.message, {}).render();
        return;
    }

    RESTResponseMgr.createSuccess(result).render();
};

exports.getPayPalOrder.public = true;
