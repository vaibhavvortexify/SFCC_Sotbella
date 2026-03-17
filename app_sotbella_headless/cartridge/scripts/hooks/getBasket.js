'use strict';

const Status = require('dw/system/Status');
const Logger = require('dw/system/Logger');
const PromotionMgr = require('dw/campaign/PromotionMgr');
const ProductInventoryMgr = require('dw/catalog/ProductInventoryMgr');
exports.modifyGETResponse_v2 = function (customer, customerBasketsResultResponse) {
	const ProductFactory = require('*/cartridge/scripts/factories/product');
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}
	var customerBaskets = customerBasketsResultResponse.baskets;

	if (!customerBasketsResultResponse.baskets) {
		return;
	}

	var shippingPromotions = [];
	try {
		var productPromos = PromotionMgr.getActiveCustomerPromotions(true).getShippingPromotions();
		var iter = productPromos.iterator();
		while (iter.hasNext()) {
			var promo = iter.next();
			shippingPromotions.push({
				id: promo.ID,
				name: promo.getName(),
				details: promo.details && promo.details.source ? promo.details.source : '',
				callout: promo.calloutMsg && promo.calloutMsg.source ? promo.calloutMsg.source : '',
				couponRequired: promo.basedOnCoupons === true,
				coupons:
					promo.coupons && !promo.coupons.empty
						? promo.coupons.toArray().map(function (c) {
								return c.ID;
						  })
						: [],
			});
		}
		Logger.debug('Shipping promotions attached: {0}', shippingPromotions.length);
	} catch (e) {
		Logger.error('Error fetching shipping promotions: {0}', e.message);
		shippingPromotions = [e, e.message];
	}

	var orderPromotions = [];
	try {
		var productPromos = PromotionMgr.getActiveCustomerPromotions(true).getOrderPromotions();
		var iter = productPromos.iterator();
		while (iter.hasNext()) {
			var promo = iter.next();
			orderPromotions.push({
				id: promo.ID,
				name: promo.getName(),
				details: promo.details && promo.details.source ? promo.details.source : '',
				callout: promo.calloutMsg && promo.calloutMsg.source ? promo.calloutMsg.source : '',
				couponRequired: promo.basedOnCoupons === true,
				coupons:
					promo.coupons && !promo.coupons.empty
						? promo.coupons.toArray().map(function (c) {
								return c.ID;
						  })
						: [],
			});
		}

		Logger.debug('Shipping promotions attached: {0}', shippingPromotions.length);
	} catch (e) {
		Logger.error('Error fetching shipping promotions: {0}', e.message);
		orderPromotions = [e, e.message];
	}
	var freshInventoryMap = request.custom.freshInventory || {};
	for (let i = 0; i < customerBaskets.length; i++) {
		var productItems = customerBaskets[i].productItems;

		var basket = customerBaskets[i];
		basket.c_shippingPromotions = shippingPromotions;
		basket.c_orderPromotions = orderPromotions;

		for (let i = 0; i < productItems.length; i++) {
			var pli = productItems[i];
			try {
				var apiProduct = ProductFactory.get({ pid: pli.productId });
				if (!apiProduct) {
					Logger.error('Could not find product with ID: {0} while enriching basket.', pli.productId);
					continue;
				}

				pli.c_images = apiProduct.images;
				pli.c_variationAttributes = apiProduct.variationAttributes;
				//@ts-ignore
				if (freshInventoryMap.hasOwnProperty(pli.productId)) {
                    // Use the direct value from the snapshot
                    pli.c_inventoryCount = freshInventoryMap[pli.productId];
                } 
                else {
                    // Fallback to SFCC database if snapshot didn't have it
					//@ts-ignore
                    var inventoryRecord = ProductInventoryMgr.getInventoryList().getRecord(pli.productId);
                    pli.c_inventoryCount = inventoryRecord ? inventoryRecord.allocation.value : 0;
                }
			} catch (e) {
				Logger.error('Error enriching product {0} in basket. Exception: {1}', pli.productId, e.message);
			}
		}
	}
	return new Status(Status.OK);
};
