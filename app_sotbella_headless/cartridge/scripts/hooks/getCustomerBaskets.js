'use strict';

var Logger = require('dw/system/Logger').getLogger('UNICOMMERCE', 'BeforeGetBaskets');
var Status = require('dw/system/Status');
var BasketMgr = require('dw/order/BasketMgr');



/**
 * Hook: dw.ocapi.shop.customer.baskets.beforeGET
*
* Triggered before OCAPI returns customer baskets.
*
* @param {String} customerId
* @returns {dw.system.Status}
*/
exports.beforeGET = function (customerId) {
    try {
        var GetUpdateInventoryHelper = require('*/cartridge/scripts/helpers/GetUpdateInventoryHelper');
        Logger.info('beforeGET hook triggered for customer: {0}', customerId);

        // Get current basket
        var basket = BasketMgr.getCurrentBasket();

        if (!basket) {
            Logger.info('No active basket found for customer: {0}', customerId);
            return new Status(Status.OK);
        }

        var snapshots = GetUpdateInventoryHelper.getSnapshots(basket);

        if (snapshots.error) {
            Logger.error('Error fetching inventory snapshots: {0}', snapshots.error);
            if(snapshots.error === 'No sku in basket') return new Status(Status.OK);
            return new Status(Status.ERROR, snapshots.error);
        }
        var freshInventoryMap = {};
        if (snapshots && snapshots.length > 0) {
            snapshots.forEach(function (item) {
                // itemTypeSKU and inventory are the keys you confirmed
                if (item.itemTypeSKU) {
                    freshInventoryMap[item.itemTypeSKU] = item.inventory;
                }
            });
        }
        
        // Save to request object for modifyGETResponse to use
        //@ts-ignore
        request.custom.freshInventory = freshInventoryMap;
        var result = GetUpdateInventoryHelper.updateInventoryForBasket(snapshots);
        Logger.info(
            'Inventory updated BEFORE ADD. Updated SKUs = {0}, Failed SKUs = {1}',
            JSON.stringify(result.updated),
            JSON.stringify(result.failed)
        );


        // Allow OCAPI request to continue
        return new Status(Status.OK);

    } catch (e) {
        Logger.error('Error in beforeGET hook: {0}', e.message);
        return new Status(Status.ERROR);
    }
};
