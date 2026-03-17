'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

/**
 * Helper: Generate Tracking Link based on provider
 */
function getTrackingLink(order) {
    var trackingLink = '';
    
    try {
        var providerJsonString = Site.getCurrent().getCustomPreferenceValue('trackingLinks'); 
        var trackingNumber = order.custom.trackingNumber;
        var provider = order.custom.shippingProvider; // e.g., "SHIPROCKET"

        if (providerJsonString && trackingNumber && provider) {
            var providerMap = JSON.parse(providerJsonString);
            var baseUrl = providerMap[provider]; 
            
            if (baseUrl) {
                trackingLink = baseUrl + trackingNumber;
            }
        }
    } catch (e) {
        Logger.error('Error generating tracking link: ' + e.message);
    }
    
    return trackingLink;
}

/**
 * Main Endpoint Function
 */
exports.trackOrder = function () {
    try {

        // Parse Request
        var requestBody = request.httpParameterMap.requestBodyAsString;
        if (!requestBody) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Request body is required', {}).render();
        }

        var requestJSON;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Invalid JSON format', {}).render();
        }

        var orderNumber = requestJSON.orderId;
        var awbNumber = requestJSON.awbNumber;

        if (!orderNumber && !awbNumber) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Please provide either orderId or awbNumber.', {}).render();
        }

        var order = null;

        // 3. Find Order Strategy
        if (orderNumber) {
            // Strategy A: Lookup by Order Number
            order = OrderMgr.getOrder(orderNumber);
        } else if (awbNumber) {
            // Strategy B: Lookup by AWB (Tracking Number)
            // We search for an order where custom.trackingNumber equals the provided AWB
            var orderQuery = OrderMgr.searchOrders('custom.trackingNumber = {0}', 'creationDate desc', awbNumber);
            if (orderQuery.count > 0) {
                order = orderQuery.first();
            }
            orderQuery.close();
        }

        // 4. Validate Order Existence
        if (!order) {
            return RESTResponseMgr.createError(404, 'NotFound', 'ORDER NOT FOUND','order not found for the provided details.').render();
        }

        // 6. Check if Order actually has a tracking number
        if (!order.custom.trackingNumber) {
             return RESTResponseMgr.createError(404, 'NotFound', 'Tracking details are not yet available for this order.', {}).render();
        }

        // 7. Generate Link
        var trackingLink = getTrackingLink(order);

        if (!trackingLink) {
             // If we have a number but couldn't generate a link (missing config), return just the number or a fallback
             return RESTResponseMgr.createSuccess({
                status: 'success',
                trackingNumber: order.custom.trackingNumber,
                message: 'We are not able to generate tracking link at this moment, please check courier website manually.'
            }).render();
        }

        // 8. Success Response
        return RESTResponseMgr.createSuccess({
            status: 'success',
            orderNumber: order.orderNo,
            trackingNumber: order.custom.trackingNumber,
            trackingLink: trackingLink
        }).render();

    } catch (e) {
        Logger.error('Error in trackOrder: {0}', e.message);
        return RESTResponseMgr.createError(500, 'InternalServerError', e.message, {}).render();
    }
};

exports.trackOrder.public = true;