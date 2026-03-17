'use strict';
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var OrderMgr = require('dw/order/OrderMgr');
/**
 * Cancels an order (either full or partial based on parameters)
 * * @param {string} orderNo - The Order ID
 * @param {string} sku - The Product ID (required only if cancelWholeOrder is false)
 * @param {string} accessToken - Auth token for the service
 * @param {boolean} cancelWholeOrder - If true, cancels entire order and ignores SKU logic
 */
function cancelSaleOrder(orderNo, sku, cancelWholeOrder, accessToken) {
    
    // Variables for Partial Cancellation (only populated if needed)
    var itemCodes = [];
    var cancellationReason = "Other"; // Default fallback

    // --- LOGIC BRANCHING ---
    // Only perform the heavy lifting (Order lookup + PLI Iteration) if we are doing a PARTIAL cancel.
    if (!cancelWholeOrder) {
        var order = OrderMgr.getOrder(orderNo);
        
        if (order) {
            var allPlis = order.getProductLineItems();
            var iter = allPlis.iterator();

            // Iterate through ALL PLIs to find every instance of this SKU
            while (iter.hasNext()) {
                var pli = iter.next();

                // Check if this PLI matches the SKU we want to cancel
                if (pli.getProductID() === sku) {

                    // 1. Generate Codes for THIS specific PLI based on its quantity
                    // Format: OrderNo - UUID - Counter (1-based)
                    var quantity = pli.getQuantityValue();
                    for (var i = 1; i <= quantity; i++) {
                        itemCodes.push(orderNo + '-' + pli.UUID + '-' + i);
                    }

                    // 2. Capture Reason (Will take the last valid reason found, or first)
                    if ('cancellationReason' in pli.custom && pli.custom.Reason) {
                        cancellationReason = pli.custom.Reason;
                    }
                }
            }
        }
    }

    var callbacks = {
        createRequest: function (svc) {
            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/oms/saleOrder/cancel';
            svc.setURL(fullURL);

            var body = {};

            // --- PAYLOAD CONSTRUCTION ---
            if (cancelWholeOrder) {
                // Scenario 1: Cancel Whole Order
                // Payload contains ONLY saleOrderCode
                body = {
                    "saleOrderCode": orderNo
                };
            } else {
                // Scenario 2: Cancel Partial (Specific Items)
                // Payload contains all item details
                body = {
                    "saleOrderCode": orderNo,
                    "saleOrderItemCodes": itemCodes, 
                    "cancelPartially": true,
                    "cancellationReason": cancellationReason
                };
            }

            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            try {
                return JSON.parse(client.text);
            } catch (e) {
                return {};
            }
        },
        mockCall: function () {
            return {
                "successful": true,
                "message": null,
                "errors": [],
            }
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}
module.exports = {cancelSaleOrder};