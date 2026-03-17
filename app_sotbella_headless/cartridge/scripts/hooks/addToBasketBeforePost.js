'use strict';

var Logger = require('dw/system/Logger').getLogger('UNICOMMERCE', 'BeforeAddItem');
var Status = require('dw/system/Status');

exports.beforePOST = function (basket, items) {
    try {
        var GetUpdateInventoryHelper = require('*/cartridge/scripts/helpers/GetUpdateInventoryHelper');

        var itemsArray = [];

        if (items) { 
            if ('length' in items) {
                for (var i = 0; i < items.length; i++) {
                    itemsArray.push(items[i]);
                }
            }  
            else if ('iterator' in items && typeof items.iterator === 'function') {
                var iter = items.iterator();
                while (iter.hasNext()) {
                    itemsArray.push(iter.next());
                }
            }
        }
        // =====================================================================

        if (!basket) {
            Logger.warn('beforePOST: No basket found.');
            return new Status(Status.OK);
        }

        // Use 'itemsArray' instead of 'items' from here on
        var BasketItemsQuantityMap = GetUpdateInventoryHelper.getBaksetItemsQuantityMap(basket, itemsArray);

        // Extract SKUs from incoming items
        var extraSKUs = [];
    
        itemsArray.forEach(function (i) {
            if (i.productId) extraSKUs.push(i.productId);
        });

        var snapshots = GetUpdateInventoryHelper.getSnapshots(basket, extraSKUs);

        if (snapshots.error) {
            Logger.error('Error fetching inventory snapshots: {0}', snapshots.error);
            return new Status(Status.ERROR, snapshots.error);
        }

        var skuMap = {};

        // Assuming snapshots is always a JS Array. If not, you might need similar normalization.
        if (snapshots && snapshots.forEach) { 
            snapshots.forEach(function (item) {
                var sku = item.itemTypeSKU;
                var availableQty = item.inventory || 0;

                skuMap[sku] = availableQty;
            });
        }

        var result = GetUpdateInventoryHelper.updateInventoryForBasket(snapshots);

        Logger.info(
            'Inventory updated BEFORE Add to basket. Updated SKUs = {0}, Failed SKUs = {1}',
            JSON.stringify(result.updated),
            JSON.stringify(result.failed)
        );

        // Check each incoming item against available inventory
        itemsArray.forEach(function (i) {
            var sku = i.productId;
            var availableQty = skuMap[sku] || 0;
            
            // Check if the requested quantity exceeds available stock
            if (availableQty < BasketItemsQuantityMap[sku]) {
                Logger.info('Product {0} has insufficient stock. Available: {1}, Requested: {2}. Preventing add to basket.', sku, availableQty, BasketItemsQuantityMap[sku]);
                throw new Error('Product ' + sku + ' has insufficient stock.');
            }
        });

        return new Status(Status.OK);

    } catch (e) {
        Logger.error('beforePOST error: {0}', e.message);
        return new Status(Status.ERROR, null, e.message);
    }
};
