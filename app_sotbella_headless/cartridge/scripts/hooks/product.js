'use strict';

var Status = require('dw/system/Status');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var PromotionMgr = require('dw/campaign/PromotionMgr');

exports.modifyGETResponse = function (scriptProduct, doc) {
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}

	try {
		var collections = require('*/cartridge/scripts/util/collections');
		var sizeGuide = require('*/cartridge/scripts/helpers/sizeGuide.js');
		var ProductMgr = require('dw/catalog/ProductMgr');

		var category = doc.primary_category_id;

		if (doc.c_wearType) {
			var data = sizeGuide.getSizeGuide(doc.c_wearType);
			if (data) {
				doc.c_sizeTopwear = data.sizeTopwear ? data.sizeTopwear : null;
				doc.c_sizeDataTopwear = data.sizeDataTopwear ? data.sizeDataTopwear : null;
				doc.c_sizeBottomwear = data.sizeBottomwear ? data.sizeBottomwear : null;
				doc.c_sizeDataBottomwear = data.sizeDataBottomwear ? data.sizeDataBottomwear : null;
			}
		}

		var masterProduct = ProductMgr.getProduct(doc.id);
		if (masterProduct && masterProduct.isMaster()) {
			var thresholdValue = Site.getCurrent().getCustomPreferenceValue('lowInventoryThresholdValue');
			var thresholdMessage = Site.getCurrent().getCustomPreferenceValue('lowInventoryThresholdMessage');
			var variationModel = masterProduct.getVariationModel();
			var variants = variationModel.getVariants();
			var variationQuantities = {};

			collections.forEach(variants, function (variant) {
				var inventoryRecord = variant.getAvailabilityModel().getInventoryRecord();
				if (inventoryRecord) {
					var ats = inventoryRecord.getATS().value;
					variationQuantities[variant.ID] = ats;
				} else {
					variationQuantities[variant.ID] = 0;
				}
			});

			collections.forEach(doc.variants, function (docVariant) {
				var ats = variationQuantities[docVariant.productId];
				docVariant.c_ats = variationQuantities[docVariant.productId];
				if (thresholdValue && thresholdMessage)
					if (ats <= thresholdValue) docVariant.c_lowInventoryMessage = thresholdMessage;
			});
		} else {
			Logger.info(`Product is not master to get variants ats.`);
		}

		var styleWithPref = Site.getCurrent().getCustomPreferenceValue('styleWith');
		if (styleWithPref) {
			try {
				var parsed = JSON.parse(styleWithPref);
				if (category in parsed) {
					doc.c_styleWith = parsed[category];
				} else {
					Logger.info('No category matched');
				}
			} catch (e) {
				Logger.info('Custom Preference is not in correct Format');
			}
		} else {
			Logger.info(`No preference or value found for 'Style With'.`);
		}
	} catch (e) {
		Logger.error('Error : {1}', e.message);
	}

	// Active promotion Additions
	try {
		var promotions = [];
		var productPromos = PromotionMgr.getActiveCustomerPromotions(true).getPromotions(scriptProduct);
		var iter = productPromos.iterator();
		while (iter.hasNext()) {
			var promo = iter.next();
			promotions.push({
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

		doc.c_promotions = promotions;
		Logger.debug('Product {0} promotions attached: {1}', scriptProduct.ID, promotions.length);
	} catch (e) {
		Logger.error('Error fetching promotions for product {0}: {1}', scriptProduct.ID, e.message);
		doc.c_promotions = e.message;
	}
	return new Status(Status.OK);
};
