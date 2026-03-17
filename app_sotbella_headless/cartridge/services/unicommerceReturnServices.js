'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var System = require('dw/system/System');


/**
 * Builds the request body for Unicommerce Reverse Pickup
 * LOGIC: Finds ALL PLIs with the matching SKU and adds ALL units to the return.
 * * @param {dw.order.Order} order - The SFCC Order object
 * @param {Object} returnContext - External parameters (sku, reason, customerImageUrl, pickupAddress)
 */
function buildReversePickupBody(order, returnContext) { 

    var reversePickItems = [];
    var targetSku = returnContext.sku;

    // Get all line items from the order
    var allLineItems = order.getAllProductLineItems();

    for (var i = 0; i < allLineItems.length; i++) {
        var pli = allLineItems[i];

        // 1. Check if this PLI matches the target SKU
        if (pli.productID === targetSku) {

            // 2. We are returning ALL quantities for this SKU.
            var qtyInPli = pli.quantityValue;

            // 3. Explode the quantity into individual items (1 to Total Qty in this PLI)
            for (var k = 1; k <= qtyInPli; k++) {

                var compositeCode = order.orderNo + '-' + pli.getUUID() + '-' + k;

                var itemObj = {
                    "saleOrderItemCode": compositeCode,
                    "reason": returnContext.reason,
                    "customerImageUrl": returnContext.customerImageUrl || ""
                };
                reversePickItems.push(itemObj);
            }
        }
    }

    return {
        "saleOrderCode": order.orderNo,
        "reversePickItems": reversePickItems, 
        "actionCode": "WAC"
    };
}


/**
 * Calls Unicommerce Create Reverse Pickup API
 * @returns {Object} response object
 */
function createReversePickup(order, returnContext, accessToken) {
    var callbacks = {
        createRequest: function (svc) {
            var orgPrefs = System.getPreferences().getCustom();

            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Facility', orgPrefs.UnicommerceFacility);

            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/oms/reversePickup/create';
            svc.setURL(fullURL);

            var body = buildReversePickupBody(order, returnContext);

            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            return JSON.parse(client.text);
        },
        mockCall: function () {
            return {
                ok: true
            };
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}

/**
 * Calls Unicommerce Create Reverse Pickup API
 * @returns {Object} response object
 */
function allocateCourierForReversePickup(reversePickupCode, accessToken) {
    var callbacks = {
        createRequest: function (svc) {
            var orgPrefs = System.getPreferences().getCustom();

            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Facility', orgPrefs.UnicommerceFacility);

            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/oms/reversePickup/assignReverseProvider';
            svc.setURL(fullURL);

            var body = {
                "reversePickupCodes": [
                    reversePickupCode
                ]
            }

            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            return JSON.parse(client.text);
        },
        mockCall: function () {
            return {
                ok: true
            };
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}


module.exports = {
    createReversePickup,
    allocateCourierForReversePickup
};