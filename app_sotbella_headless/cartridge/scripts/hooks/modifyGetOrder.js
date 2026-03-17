'use strict';

const Status = require('dw/system/Status');
const Logger = require('dw/system/Logger');
const ProductFactory = require('*/cartridge/scripts/factories/product');
const ProductMgr = require('dw/catalog/ProductMgr');

/**
 * Hook: dw.ocapi.shop.order.modifyGETResponse
 * Enriches the order response with product details (images, variations, etc.)
 *
 * @param {dw.order.Order} order - The SFCC order object.
 * @param {Object} orderResponse - The OCAPI response object.
 * @returns {dw.system.Status}
 */
exports.modifyGETResponse = function (order, orderResponse) {


    try {
        // Defensive check
        if (!orderResponse.productItems || !orderResponse.productItems.length) {
            Logger.debug('No productItems found in order response.');
            return new Status(Status.OK);
        }

        // Convert ArrayList to JS Array (OCAPI returns dw.util.ArrayList)
        var productItems = orderResponse.productItems.toArray();

        // Loop through each product line item in the order
        for (let i = 0; i < productItems.length; i++) {
            let pli = productItems[i];

            try {
                var product = ProductMgr.getProduct(pli.productId);
                if (!product) {
                    Logger.error('Product not found for ID: {0}', pli.productId);
                    continue;
                }

                // Use SFRA Product Factory to get full model
                var apiProduct = ProductFactory.get({ pid: pli.productId });

                // ✅ Attach limited product info using c_ prefix
                pli.c_images = apiProduct.images;
                pli.c_variationAttributes = apiProduct.variationAttributes;
                pli.c_shortDescription = product.shortDescription
                    ? product.shortDescription.source
                    : null;

            } catch (innerErr) {
                Logger.error('Error enriching product {0} in order {1}: {2}', pli.productId, order.orderNo, innerErr.message);
            }
        }

        Logger.debug('modifyGETResponse completed successfully for order {0}', order.orderNo);
        return new Status(Status.OK);

    } catch (e) {
        Logger.error('modifyGETResponse failed for order {0}: {1}', order.orderNo, e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};
