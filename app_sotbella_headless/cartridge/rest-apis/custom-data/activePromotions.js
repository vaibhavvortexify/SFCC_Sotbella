'use strict';

var Site = require('dw/system/Site');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var CouponMgr = require('dw/campaign/CouponMgr');
var BasketMgr = require('dw/order/BasketMgr');
var PromotionMgr = require('dw/campaign/PromotionMgr');
var Logger = require('dw/system/Logger');

function getPromotionsData(productPromos) {
	var promotions = [];
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
							return c.nextCouponCode;
					  })
					: [],
		});
	}
	return promotions;
}

exports.getActivePromotions = function () {
	var req = request;
	if (!req.session.customerAuthenticated) {
		var faultResponse = RESTResponseMgr.createError(
			401,
			'',
			'CUSTOMER_NOT_AUTHENTICATED',
			'Authentication is required before coupons can be viewed.'
		);
		faultResponse.render();
		return;
	}

	var customer = req.session.customer;
	var basket = BasketMgr.getCurrentBasket();

	try {
		var promotions = PromotionMgr.getPromotions();
		var promotionsData = getPromotionsData(promotions);
		var customerPromotions = PromotionMgr.getActiveCustomerPromotions(true).getPromotions();
		var customerPromotionsData = getPromotionsData(customerPromotions);
		Logger.debug('Promotions: {1}', promotionsData);

		RESTResponseMgr.createSuccess({
			count: promotionsData.length,
			total: promotionsData.length,
			customerPromotions: customerPromotionsData,
			promotions: promotionsData,
		}).render();
		return;
	} catch (e) {
		Logger.error('Error: {0}', e.message);
		Logger.error('Full stack trace: {0}', e.stack);
		var serverError = RESTResponseMgr.createError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
		serverError.render();
		return;
	}
};

exports.getActivePromotions.public = true;
