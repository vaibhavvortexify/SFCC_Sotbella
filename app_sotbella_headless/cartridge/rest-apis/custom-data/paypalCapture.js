'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');

var paypalService = require('*/cartridge/services/paypalService');
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

exports.capturePayPalOrderData = function () {
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
        if (!paymentInstrument || !paymentInstrument.custom.paypal_order_id) {
            return {
                error: true,
                statusCode: 404,
                type: 'NotFound',
                message: 'No PayPal order found for this SFCC order'
            };
        }

        if (body.paypalOrderId && body.paypalOrderId !== paymentInstrument.custom.paypal_order_id) {
            return {
                error: true,
                statusCode: 409,
                type: 'Conflict',
                message: 'PayPal order ID does not match the SFCC order'
            };
        }

        var getOrderResp = paypalService.getOrder({
            paypalOrderId: paymentInstrument.custom.paypal_order_id
        });

        if (!getOrderResp.ok || !getOrderResp.object || !getOrderResp.object.id) {
            return {
                error: true,
                statusCode: 502,
                type: 'BadGateway',
                message: 'Unable to retrieve PayPal order'
            };
        }

        var syncResult = paypalHelper.syncOrderWithPayPal(order, getOrderResp.object);
        if (!syncResult.success) {
            return {
                error: true,
                statusCode: 422,
                type: 'UnprocessableEntity',
                message: syncResult.message || 'Unable to finalize PayPal order'
            };
        }

        var refreshedPaymentInstrument = paypalHelper.getPayPalPaymentInstrument(order);
        return {
            success: true,
            orderNo: order.orderNo,
            paypalOrderId: refreshedPaymentInstrument.custom.paypal_order_id || '',
            paypalOrderStatus: refreshedPaymentInstrument.custom.paypal_order_status || '',
            paypalCaptureId: refreshedPaymentInstrument.custom.paypal_capture_id || '',
            paypalCaptureStatus: refreshedPaymentInstrument.custom.paypal_capture_status || syncResult.status || '',
            orderStatus: order.status.displayValue,
            paymentStatus: order.paymentStatus.displayValue
        };
    } catch (e) {
        Logger.error('Error in capturePayPalOrderData: {0}', e.message);
        return {
            error: true,
            statusCode: 500,
            type: 'InternalServerError',
            message: e.message
        };
    }
};

exports.capturePayPalOrder = function () {
    var result = exports.capturePayPalOrderData();
    if (result.error) {
        RESTResponseMgr.createError(result.statusCode, result.type, result.message, {}).render();
        return;
    }

    RESTResponseMgr.createSuccess(result).render();
};

exports.capturePayPalOrder.public = true;
