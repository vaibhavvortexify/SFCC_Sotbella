/* eslint-disable valid-jsdoc */
/* eslint-disable no-lonely-if */
/* eslint-disable require-jsdoc */

'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

/**
 * Map update type to orderStatus integer value.
 * Adjust if you use different enum integers.
 */
function getOrderStatusByUpdateType(updateType) {
    var map = {
        cancel: 5,   // Cancelled
        return: 6,   // Returned
        exchange: 2  // Processing / Exchange
    };
    return map[updateType] || null;
}

/**
 * Get deadline (in days) from site custom preferences for a given updateType.
 * Returns:
 *  - integer > 0: configured deadline in days
 *  - null: preference not configured
 */
function getDeadlineForUpdateType(updateType) {
    var site = Site.getCurrent();
    if (!site) {
        return null;
    }
    var val;
    switch (updateType) {
        case 'cancel':
            val = site.getCustomPreferenceValue('orderCancelDeadline');
            break;
        case 'return':
            val = site.getCustomPreferenceValue('orderReturnDeadline');
            break;
        case 'exchange':
            val = site.getCustomPreferenceValue('orderExchangeDeadline');
            break;
        default:
            val = null;
    }
    // ensure integer or null
    if (val === null || val === undefined) {
        return null;
    }
    var intVal = parseInt(val, 10);
    if (isNaN(intVal)) {
        return null;
    }
    return intVal;
}

/**
 * Calculate days difference between now and the provided Java Date (order creationDate).
 * Returns integer days elapsed, or null if creationDate not provided.
 */
function daysSince(dateObj) {
    if (!dateObj) {
        return null;
    }
    try {
        // order.creationDate is a Java Date — getTime() yields milliseconds
        var createdMs = dateObj.getTime ? dateObj.getTime() : (new Date(dateObj)).getTime();
        var nowMs = new Date().getTime();
        var diffMs = nowMs - createdMs;
        var days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        return days;
    } catch (e) {
        Logger.warn('Error computing daysSince for date: {0} | {1}', dateObj, e.message);
        return null;
    }
}

exports.updateOrderData = function () {
    var req = request;
    var body;
    try {
        body = JSON.parse(req.httpParameterMap.requestBodyAsString || '{}');
    } catch (e) {
        return {
            success: false,
            message: 'Invalid JSON format in request body'
        };
    }

    var orderId = body.orderNo;
    var updateType = body.updateType;
    var reason = body.reason;

    if (!orderId || !updateType || !reason) {
        return {
            success: false,
            message: 'Missing required fields: orderNo, updateType, reason'
        };
    }

    // validate updateType supported
    var newStatus = getOrderStatusByUpdateType(updateType);
    if (newStatus === null) {
        return {
            success: false,
            message: 'Invalid updateType provided. Allowed values: cancel, return, exchange'
        };
    }

    var order = OrderMgr.getOrder(orderId);
    if (!order) {
        return {
            success: false,
            message: 'Order not found'
        };
    }

    // Ensure the customer owns this order
    var customer = req.session.customer;
    if (!customer || !customer.profile || order.customerNo !== customer.profile.customerNo) {
        return {
            success: false,
            message: 'Unauthorized: This order does not belong to the current customer'
        };
    }

    // Deadline check
    var deadlineDays = getDeadlineForUpdateType(updateType);
    if (deadlineDays !== null && deadlineDays > 0) {
        var created = order.creationDate;
        var elapsedDays = daysSince(created);

        if (elapsedDays === null) {
            // If creation date missing, warn but allow update (you can change this behavior if you'd prefer block)
            Logger.warn('Order {0} has no creationDate; skipping deadline check for updateType {1}', orderId, updateType);
        } else {
            if (elapsedDays > deadlineDays) {
                return {
                    success: false,
                    message: 'Deadline exceeded. The ' + updateType + ' request must be made within ' + deadlineDays + ' day(s) of order creation.'
                };
            }
        }
    } // else: preference not set or <=0 => skip deadline enforcement

    // Proceed to update custom attributes within a transaction
    try {
        Transaction.wrap(function () {
            order.custom.reason = reason;
            order.custom.orderStatus = newStatus;
        });

        Logger.info('Order {0} updated successfully with {1}', orderId, updateType);

        return {
            success: true,
            orderNo: order.orderNo,
            message: 'Order updated successfully'
        };
    } catch (e) {
        Logger.error('Error updating order {0}: {1}', orderId, e.message);
        return {
            success: false,
            message: 'Error updating order: ' + e.message
        };
    }
};

/**
 * REST endpoint entry point
 */
exports.updateOrder = function () {
    RESTResponseMgr.createSuccess(exports.updateOrderData()).render();
};

exports.updateOrder.public = true;
