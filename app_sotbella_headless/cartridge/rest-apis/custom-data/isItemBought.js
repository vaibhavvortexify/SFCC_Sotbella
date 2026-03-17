'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var OrderMgr = require('dw/order/OrderMgr');
var ProductMgr = require('dw/catalog/ProductMgr'); // <--- 1. Import ProductMgr

/**
 * Custom API Endpoint: Is Item Bought
 * Path: /isItemBought
 * Method: GET
 */
exports.isItemBought = function () {
    try {
        // 1. Validate Site ID
        var siteId = request.httpParameterMap.siteId.stringValue;
        if (!siteId) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Site ID is missing', {}).render();
        }

        // 2. Validate Product ID
        var productId = request.httpParameterMap.c_productId.stringValue;
        if (!productId) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Product ID is missing', {}).render();
        }

        // 3. Validate Logged-in Customer
        if (!customer.isAuthenticated() || !customer.getProfile()) {
            return RESTResponseMgr.createError(401, 'Unauthorized', 'User not logged in', {}).render();
        }

        // --- NEW LOGIC: Resolve Target Master ID ---
        var targetProduct = ProductMgr.getProduct(productId);
        if (!targetProduct) {
            // If the product ID passed doesn't exist in catalog, they can't review it/check bought status
            return RESTResponseMgr.createError(404, 'NotFound', 'Product not found in catalog', {}).render();
        }

        // If it's a variant, get Master ID. If it's standard/master, get its own ID.
        var targetMasterId = targetProduct.isVariant() ? targetProduct.getMasterProduct().getID() : targetProduct.getID();
        // -------------------------------------------

        var customerNo = customer.getProfile().getCustomerNo();

        // 4. Execute Order Search (All Time)
        // Criteria:
        // - Customer matches logged in user
        // - custom.orderStatus is 12 (Delivered) - as per your search arguments
        var queryString = "customerNo = {0} AND custom.orderStatus = {1}";
        var sortString = "lastModified desc";

        var orderIterator = OrderMgr.searchOrders(
            queryString,
            sortString,
            customerNo,
            12 // {1} - Custom Status 12 (Delivered)
        );

        var isBought = false;

        // 5. Iterate Orders to find the Product (By Master ID)
        while (orderIterator.hasNext()) {
            var order = orderIterator.next();
            var productLineItems = order.getProductLineItems();
            var pliIter = productLineItems.iterator();

            while (pliIter.hasNext()) {
                var pli = pliIter.next();
                
                // Get the product object from the line item to check hierarchy
                var pliProduct = pli.getProduct();

                // Ensure product still exists in catalog
                if (pliProduct) {
                    // Resolve Master ID for the purchased item
                    var pliMasterId = pliProduct.isVariant() ? pliProduct.getMasterProduct().getID() : pliProduct.getID();

                    // Compare MASTER IDs
                    if (pliMasterId === targetMasterId) {
                        if (pli.custom && pli.custom.lineItemStatus == 5) { // Delivered
                            isBought = true;
                            break; // Found it, break inner loop
                        }
                    }
                }
            }

            if (isBought) {
                break; // Found it, break outer loop
            }
        }
        orderIterator.close();

        // 6. Return Response
        return RESTResponseMgr.createSuccess({
            isItemBought: isBought
        }).render();

    } catch (error) {
        Logger.error('Error in isItemBought API: {0}', error.message);
        return RESTResponseMgr.createError(500, 'InternalServerError', error.message, {}).render();
    }
};

exports.isItemBought.public = true;