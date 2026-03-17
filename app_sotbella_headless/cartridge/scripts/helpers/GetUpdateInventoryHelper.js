'use strict';

var Logger = require('dw/system/Logger').getLogger('UNICOMMERCE', 'InventoryHelper');
var ProductInventoryMgr = require('dw/catalog/ProductInventoryMgr');
var Site = require('dw/system/Site');

var getInventoryUpdates = require('*/cartridge/services/unicomInventorySnapshot').getInventoryUpdates;
var callGetInventoryUpdates = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callGetInventoryUpdates;
var InventoryServices = require('*/cartridge/services/InventoryServices');
var oauthService = require('*/cartridge/services/AdminAuthService');

/**
 * Extracts a map of product IDs to their total requested quantities from the basket and incoming items.
 * This includes quantities already in the basket plus quantities from the new items being added.
 * @param {dw.order.Basket} basket - The current basket object
 * @param {Array} items - Array of incoming items to be added to the basket
 * @return {Object} - A map where keys are product IDs and values are total requested quantities 
 */
function getBaksetItemsQuantityMap(basket, items) {
    var itemQuantityMap = {};

    if (!basket || !basket.productLineItems) {
        return itemQuantityMap;
    }
    var plis = basket.productLineItems;
    for (var i = 0; i < plis.length; i++) {
        var pli = plis[i];
        if (pli.productID) {
            itemQuantityMap[pli.productID] = (itemQuantityMap[pli.productID] || 0) +  pli.quantityValue;
        }
    }
    
    if (items.length > 0)
        items.forEach(function (i) {
            if (i.productId) {
                itemQuantityMap[i.productId] = (itemQuantityMap[i.productId] || 0) + (i.quantity || 0);
            }
        });

    Logger.info('Extracted item quantity map from basket: {0}', JSON.stringify(itemQuantityMap));
    return itemQuantityMap;
}


/**
 * Extracts list of product SKUs from a basket object.
 *
 * @param {dw.order.Basket} basket - Basket object
 * @returns {Array} - Array of product IDs (SKUs)
 */
function getBasketSkus(basket) {
    var skus = [];

    if (!basket || !basket.productLineItems) {
        return skus;
    }

    var plis = basket.productLineItems;

    for (var i = 0; i < plis.length; i++) {
        var pli = plis[i];
        if (pli.productID) {
            skus.push(pli.productID);
        }
    }

    Logger.info('Extracted SKUs from basket: {0}', skus.join(', '));
    return skus;
}

/**
 * 
 * @param {dw.order.Basket} basket 
 * @param {Array} extraSKUs 
 * @returns 
 */
function getSnapshots(basket, extraSKUs) {

    if (!basket) {
        Logger.warn('updateInventoryForBasket called with NULL basket');
        return { updated: [], failed: [] };
    }
    var skuList = [];

    skuList = skuList.concat(getBasketSkus(basket));

    if (extraSKUs && extraSKUs.length > 0) {
        skuList = skuList.concat(extraSKUs);
    }

    skuList = skuList.filter(function (item, index) {
        return skuList.indexOf(item) === index;
    });

    if (!skuList || skuList.length === 0) {
        Logger.info('No SKUs found in basket to update inventory.');
        return { error: 'No sku in basket' };
    }

    Logger.info('Calling Unicommerce API with SKUs: {0}', JSON.stringify(skuList));

    // Call your service to get inventory updates
    var uniInventoryResopnse = callGetInventoryUpdates(-1, skuList, function (lastNMinutes, skuIds, token) {
        return getInventoryUpdates(lastNMinutes, skuIds, token);
    });

    if (!uniInventoryResopnse.ok || !uniInventoryResopnse.object || !uniInventoryResopnse.object.inventorySnapshots) {
        Logger.error('Failed Unicommerce service call: {0}', JSON.stringify(uniInventoryResopnse));
        return { error: 'Failed to get Snapshot' };
    }
    var snapshots = uniInventoryResopnse.object.inventorySnapshots;
    return snapshots;
}

/**
 * Calls Unicommerce Inventory API and updates SFCC inventory.
 * @param {object} snapshots - Inventory snapshots from Unicommerce
 * @returns {Object} - Object containing arrays of updated and failed SKUs
 */
function updateInventoryForBasket(snapshots) {
    var updated = [];
    var failed = [];

    // Loop inventory snapshot response & update SFCC inventory
    snapshots.forEach(function (item) {
        try {
            var sku = item.itemTypeSKU;
            var availableQty = item.inventory || 0; // direct inventory value

            var inventoryList = ProductInventoryMgr.getInventoryList();

            if (!inventoryList) {
                Logger.error('No default inventory list found in SFCC.');
                failed.push(sku);
                return;
            }

            var record = inventoryList.getRecord(sku);

            var currentAllocation = record ? record.ATS.value : null;

            if (currentAllocation !== null && currentAllocation === availableQty) {
                Logger.info('No change in inventory for SKU {0}, skipping update.', sku);
                return;
            }

            // /////////////////////////GETTING ADMIN ACCESS TOKEN/////////////////////
            var pref = Site.getCurrent().getPreferences().getCustom();
            var tokenResult = oauthService.call({
                scope: pref.AdminScopes
            });
            if (!tokenResult.ok || !tokenResult.object.access_token) {
                Logger.error('Failed to retrieve OAuth token: {0}', tokenResult.errorMessage);
                return;
            }
            var accessToken = tokenResult.object.access_token;
            // /////////////////////////////////////////////////////////////////////////

            // Update Allocation quantity
            var InventoryServiceResponse = InventoryServices.inventoryUpdate.call({
                accessToken: accessToken,
                inventoryListID: inventoryList.ID,
                productId: sku,
                allocation: availableQty
            })

            if (!InventoryServiceResponse.ok || InventoryServiceResponse.object.error) {
                Logger.error(
                    'Failed to update inventory for SKU {0}: {1}',
                    sku,
                    InventoryServiceResponse.errorMessage || JSON.stringify(InventoryServiceResponse.object)
                );
                failed.push(sku);
                return;
            }

            Logger.info('Updated inventory SKU {0} → {1}', sku, availableQty);
            updated.push({ sku: sku, qty: availableQty });

        } catch (e) {
            Logger.error('Error updating inventory for SKU: {0}, error: {1}', item.itemTypeSKU, e.message);
            failed.push(item.itemTypeSKU);
        }
    });

    return {
        updated: updated,
        failed: failed
    };
}

module.exports = {
    getBasketSkus: getBasketSkus,
    getSnapshots: getSnapshots,
    getBaksetItemsQuantityMap,
    updateInventoryForBasket: updateInventoryForBasket
};