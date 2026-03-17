'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var stripeService = require('*/cartridge/services/stripeService');

/**
 * Main Entry Point for cancelOrder API
 * Uses request.httpParameterMap.requestBodyAsString for manual parsing
 */
exports.cancelOrder = function () {
    try {
        // 1. MANUALLY PARSE REQUEST BODY (As requested)
        var requestBody = request.httpParameterMap.requestBodyAsString;
        
        if (!requestBody) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Request body is required', { error: 'Empty request body' }).render();
        }

        var requestJSON;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Invalid JSON format', 'Failed to parse request body').render();
        }

        // 2. EXTRACT DATA
        var orderNo = requestJSON.orderNo;

        if (!orderNo) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Order Number (orderNo) is required', {}).render();
        }

        // 3. GET ORDER
        var order = OrderMgr.getOrder(orderNo);

        if (!order) {
            return RESTResponseMgr.createError(404, 'NotFound', 'Order not found', {}).render();
        }

        // 4. SECURITY CHECK (Authentication & Ownership)
        // Ensure the user is logged in
        if (!customer.isAuthenticated()) {
             return RESTResponseMgr.createError(401, 'Unauthorized', 'You must be logged in to perform this action', {}).render();
        }

        // Ensure the order belongs to this customer
        if (order.getCustomerNo() !== customer.getProfile().getCustomerNo()) {
            Logger.warn('Security Warning: Customer {0} attempted to cancel Order {1} belonging to another user.', 
                customer.getProfile().getCustomerNo(), orderNo);
            return RESTResponseMgr.createError(403, 'Forbidden', 'You are not authorized to modify this order', 'Order owner mismatch').render();
        }

        // 5. VALIDATE ORDER STATUS
        if (order.status.value === Order.ORDER_STATUS_NEW || 
            order.status.value === Order.ORDER_STATUS_OPEN) {
            
            return RESTResponseMgr.createError(409, 'Conflict', 'Order cannot be cancelled', 'Order is already placed or open. Status: ' + order.status.displayValue).render();
        }
        // Cannot cancel/fail an order that is already completed or cancelled
        if (order.status.value === Order.ORDER_STATUS_COMPLETED || 
            order.status.value === Order.ORDER_STATUS_CANCELLED || 
            order.status.value === Order.ORDER_STATUS_FAILED) {
            
            return RESTResponseMgr.createSuccess({
                success: false,
                message: 'Order cannot be cancelled in its current state.',
                orderNo: orderNo,
                status: order.status.displayValue
            }).render();
        }

        try {
            var paymentInstruments = order.getPaymentInstruments();
            var iter = paymentInstruments.iterator();
            
            while (iter.hasNext()) {
                var pi = iter.next();
                
                // Check if Payment Method is STRIPE
                if (pi.paymentMethod.equals('STRIPE')) {
                    // Get Payment Intent ID from Custom Attribute
                    var stripePaymentIntentId = pi.custom.stripe_payment_intent_id;
                    
                    if (stripePaymentIntentId) {
                        Logger.info('Attempting to cancel Stripe Payment Intent: {0} for Order: {1}', stripePaymentIntentId, orderNo);
                        
                        // Call the Service
                        var serviceResult = stripeService.cancelPaymentIntent.call({
                            paymentIntentId: stripePaymentIntentId,
                            cancellation_reason: 'abandoned' // Optional reason for Stripe
                        });

                        if (serviceResult.ok) {
                            Logger.info('Successfully cancelled Stripe Payment Intent: {0}', stripePaymentIntentId);
                        } else {
                            // Log warning but DO NOT stop the local cancellation process
                            Logger.warn('Failed to cancel Stripe Payment Intent: {0}. Error: {1}', stripePaymentIntentId, serviceResult.errorMessage);
                        }
                    } else {
                        Logger.warn('Stripe Payment Instrument found but missing stripe_payment_intent_id for Order: {0}', orderNo);
                    }
                }
            }
        } catch (stripeError) {
            // Catch any unexpected errors in the Stripe block so we don't block the actual Order Fail
            Logger.error('Exception during Stripe Cancellation logic for Order {0}: {1}', orderNo, stripeError.message);
        }
        // 6. EXECUTE FAIL & RESTORE BASKET
        // 
        Transaction.wrap(function () {
            // Optional: Log the reason before failing
            // order.custom.cancellationReason = "User requested via API"; 
            
            // failOrder(order, true) -> Sets status to FAILED and restores items to session basket
            OrderMgr.failOrder(order, true);
        });

        // 7. SUCCESS RESPONSE
        return RESTResponseMgr.createSuccess({
            success: true,
            message: 'Order cancelled and items restored to basket.',
            orderNo: orderNo,
            status: order.status.displayValue // will be "FAILED"
        }).render();

    } catch (e) {
        Logger.error('Error in cancelOrder: {0}', e.message);
        return RESTResponseMgr.createError(500, 'InternalServerError', 'An unexpected error occurred', { detail: e.message }).render();
    }
};

exports.cancelOrder.public = true;