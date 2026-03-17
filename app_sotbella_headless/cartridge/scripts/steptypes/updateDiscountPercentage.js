'use strict';

var ProductMgr = require('dw/catalog/ProductMgr');
var Transaction = require('dw/system/Transaction');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

exports.updateDiscountPercentage = function () {
	var priceFactory = require('*/cartridge/scripts/factories/price');
	var allProducts = ProductMgr.queryAllSiteProducts();
	var productIDs = [];
	try {
		while (allProducts.hasNext()) {
			productIDs.push(allProducts.next().ID);
		}
		allProducts.close();

		productIDs.forEach(function (pid) {
			var product = ProductMgr.getProduct(pid);
			if (product) {
				var price = priceFactory.getPrice(product, Site.getCurrent().getDefaultCurrency(), true, null, null);

				if (price && price.sales) {
					var salesPrice = price.sales.value;
					var listPrice = price.list ? price.list.value : salesPrice;

					var discount = 0;
					if (listPrice > salesPrice) {
						discount = Math.round(((listPrice - salesPrice) / listPrice) * 100);
					}

					Transaction.wrap(function () {
						product.custom.discountPercentage = discount;
					});
				}
			}
		});
	} catch (error) {
		Logger.error('Steptypes Error: ', error.message);
	}

	return new dw.system.Status(dw.system.Status.OK);
};
