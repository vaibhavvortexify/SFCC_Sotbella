'use strict';

var refersionTracker = require('*/cartridge/services/RefersionTrackerWebhookService');
var UUIDUtils = require('dw/util/UUIDUtils');

/**
 * Send refersion tracking data for an order
 * @param {dw.order.Order} order
 */
function sendRefersionData(order) {
    var cartId = UUIDUtils.createUUID();
    order.custom.cartId = cartId;

    // Get coupon codes from the order
    var couponCodes = [];
    var couponLineItems = order.couponLineItems.iterator();

    while (couponLineItems.hasNext()) {
        var cli = couponLineItems.next();
        couponCodes.push(cli.couponCode);
    }

    // If NO coupon → call service once without coupon code
    if (couponCodes.length === 0) {
        refersionTracker.call({
            order: order,
            cart_id: cartId
        });
        return;
    }

    // If multiple coupons → call service multiple times
    couponCodes.forEach(function (code) {
        refersionTracker.call({
            order: order,
            cart_id: cartId,
            couponCode: code
        });
    });
}

module.exports = {
    sendRefersionData: sendRefersionData
};
