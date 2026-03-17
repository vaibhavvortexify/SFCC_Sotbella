'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');

exports.modifyGETResponse = function (doc) {
	if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
		return;
	}
	
	try {
		var collections = require('*/cartridge/scripts/util/collections');
		var sizeGuide = require('*/cartridge/scripts/helpers/sizeGuide.js');
		var products = doc.hits;
		collections.forEach(products, function (product) {
			var wearType = product.representedProduct.c_wearType;
			if (wearType) {
				var data = sizeGuide.getSizeGuide(wearType);
				if (data) {
					product.c_sizeTopwear = data.sizeTopwear ? data.sizeTopwear : null;
					product.c_sizeDataTopwear = data.sizeDataTopwear ? data.sizeDataTopwear : null;
					product.c_sizeBottomwear = data.sizeBottomwear ? data.sizeBottomwear : null;
					product.c_sizeDataBottomwear = data.sizeDataBottomwear ? data.sizeDataBottomwear : null;
				}
			} else {
				Logger.debug(
					'Wear Type not found for ProductId: {0}, ProductName: {1}.',
					product.productId,
					product.productName
				);
			}
		});
	} catch (e) {
		Logger.error('Full stack trace: {0}', e.stack);
		Logger.error('Error Message: {0}', e.message);
	}

	return new Status(Status.OK);
};
