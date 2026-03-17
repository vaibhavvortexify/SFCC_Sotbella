'use strict';

var ProductMgr = require('dw/catalog/ProductMgr');
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');
var Status = require('dw/system/Status');

/**
 * beforePOST hook for product list items.
 * Accepts c_productIdsJson (JSON string array) and creates/updates multiple items on the list.
 *
 * @param {dw.customer.Customer} customer - The current customer
 * @param {dw.customer.ProductList} productList - The product list where items will be added
 * @param {dw.customer.ProductListItem} item - The item being added to the product list
 * @returns {dw.system.Status} - Status.OK if processed successfully, or Status.ERROR on failure
 */
function beforePOST(customer, productList, item) {
    try {
        if (!item || !productList) {
            return new Status(Status.OK);
        }

        var jsonStr = null;
        if (item.c_productIdsJson && typeof item.c_productIdsJson === 'string') {
            if (item.c_productIdsJson.trim() !== '' && item.c_productIdsJson.trim() !== '[]') {
                jsonStr = item.c_productIdsJson;
            }
        }

        if (!jsonStr) {
            return new Status(Status.OK);
        }

        var parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            Logger.error('productList beforePOST: c_productIdsJson JSON parse error: {0}', e.message);
            Logger.error('productList JSON string {0}', jsonStr);
            return new Status(Status.ERROR, 'INVALID_JSON', 'Invalid c_productIdsJson format');
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
            Logger.warn('productList beforePOST: c_productIdsJson is not an array or empty.');
            return new Status(Status.OK);
        }

        // normalize: map productId -> summed quantity
        var toAdd = {};
        parsed.forEach(function (entry) {
            if (!entry) { return; }
            var pid = entry.productId || entry.product_id || entry.id;
            var qty = (entry.quantity !== undefined) ? Number(entry.quantity) : ((entry.qty !== undefined) ? Number(entry.qty) : 1);
            if (!pid) { return; }
            if (!toAdd[pid]) { toAdd[pid] = 0; }
            toAdd[pid] += (isNaN(qty) ? 1 : qty);
        });

        if (Object.keys(toAdd).length === 0) {
            return new Status(Status.OK);
        }

        // Create/update in one transaction
        Transaction.wrap(function () {
            var existingMap = {};
            var itemsColl = productList.getProductItems();
            var it = itemsColl.iterator();
            while (it.hasNext()) {
                var pli = it.next();
                var existingPid = pli.getProductID();
                existingMap[existingPid] = pli;
            }

            Object.keys(toAdd).forEach(function (pid) {
                var qty = toAdd[pid];
                if (!pid) { return; }

                var product = ProductMgr.getProduct(pid);
                if (!product) {
                    Logger.warn('productList beforePOST: product not found, skipping {0}', pid);
                    return;
                }

                if (existingMap[pid]) {
                    existingMap[pid].setQuantityValue(qty);
                } else {
                    var newItem = productList.createProductItem(product);
                    newItem.setQuantityValue(qty);
                }
            });
        });

        // ✅ Clear the transport attribute so it won’t persist
        item.c_productIdsJson = null;

        return new Status(Status.OK);

    } catch (e) {
        Logger.error('productList beforePOST error: {0}', e.message);
        var s = new Status(Status.ERROR);
        s.addDetail('error', e.message);
        return s;
    }
}

module.exports = {
    beforePOST: beforePOST
};
