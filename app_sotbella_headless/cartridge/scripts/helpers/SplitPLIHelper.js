'use strict';

var Transaction = require('dw/system/Transaction');
// var HookMgr = require('dw/system/HookMgr');

/**
 * forEach method for dw.util.Collection subclass instances
 * @param {dw.util.Collection} collection - Collection subclass instance to map over
 * @param {Function} callback - Callback function for each item
 * @param {Object} [scope] - Optional execution scope to pass to callback
 * @returns {void}
 */
function forEach(collection, callback, scope) {
    var iterator = collection.iterator();
    var index = 0;
    var item = null;
    while (iterator.hasNext()) {
        item = iterator.next();
        if (scope) {
            callback.call(scope, item, index, collection);
        } else {
            callback(item, index, collection);
        }
        index++;
    }
}


/**
 * Splits product line items in all shipments so that each has quantity = 1
 * @param {dw.order.Basket} basket - The basket to process
 */
function splitProductLineItems(basket) {
    Transaction.wrap(function () {
        forEach(basket.getShipments(), function (shipment) {
            forEach(shipment.getProductLineItems(), function (pli) {
                if (pli.getQuantityValue() > 1) {
                    var originalQuantity = pli.getQuantityValue();
                    var productId = pli.getProductID();

                    pli.setQuantityValue(1);
                    for (var i = 1; i < originalQuantity; i++) {
                        var newPli = basket.createProductLineItem(productId, shipment);
                        newPli.setQuantityValue(1);
                        newPli.setPriceValue(pli.getBasePrice().value);
                        newPli.setTaxClassID(pli.getTaxClassID());
                    }
                }
            });
        });
    });
    
    // HookMgr.callHook('dw.order.calculate', 'calculate', basket);
}

module.exports = {
    splitProductLineItems: splitProductLineItems
};
