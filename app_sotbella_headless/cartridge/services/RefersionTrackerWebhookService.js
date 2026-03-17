'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');

var refersionTracker = LocalServiceRegistry.createService('refersion.tracker', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');

        var pref = Site.getCurrent().getPreferences().getCustom();
        svc.addHeader('Refersion-Public-Key', pref.refersionClientId);
        svc.addHeader('Refersion-Secret-Key', pref.refersionClientSecret);

        var order = params.order;
        var cartId = params.cart_id;
        var couponCode = params.couponCode;

        // --- CUSTOMER FIRST & LAST NAME ---
        var fullName = order.customerName || '';
        var nameParts = fullName.trim().split(' ');
        var firstName = nameParts[0] || '';
        var lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        // --- ITEMS ---
        var items = [];
        var lineItems = order.allProductLineItems.iterator();
        while (lineItems.hasNext()) {
            var li = lineItems.next();

            if ('productID' in li && li.productID) {
                items.push({
                    price: li.basePrice.value,
                    quantity: li.quantity.value,
                    sku: li.productID,
                    name: li.productName
                });
            }
        }

        // --- DISCOUNT ---
        var discount = order.merchandizeTotalPrice.value - order.adjustedMerchandizeTotalPrice.value;

        // --- BODY ---
        var bodyObj = {
            cart_id: cartId,
            order_id: order.orderNo,
            customer: {
                first_name: firstName,
                last_name: lastName,
                email: order.customer.profile.email
            },
            shipping: order.shippingTotalPrice.value,
            tax: order.totalTax.value,
            discount: discount,
            currency_code: order.currencyCode,
            items: items
        };

        // Add coupon code only when provided
        if (couponCode) {
            bodyObj.discount_code = couponCode;
        }

        var body = JSON.stringify(bodyObj);

        return body;
    },

    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },

    mockCall: function (svc, params) {
        return {
            statusCode: 200,
            statusMessage: 'OK',
            msg: 'Success'
        };
    }
});

module.exports = refersionTracker;