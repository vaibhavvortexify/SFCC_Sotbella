'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');


var couponService = LocalServiceRegistry.createService('sfcc.coupon.create', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('PUT');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + params.accessToken);

        // Build endpoint dynamically
        var pref = Site.getCurrent().getPreferences().getCustom();
        var path = pref.organizationID + '/coupons/' + params.couponId + '?siteId=' + params.siteId;
        svc.setURL(svc.getConfiguration().getCredential().getURL() + path);

        // Prepare request body
        var body = {
            couponId: params.couponId,
            description: params.description,
            enabled: true,
            type: 'single_code',
            singleCode: params.couponId
        };

        var requestBody = JSON.stringify(body);
        return requestBody;
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
            text: JSON.stringify({
                couponId: params.couponId,
                enabled: true,
                type: 'single_code',
                singleCode: params.couponId,
                message: 'Mock coupon created successfully'
            })
        };
    }
});

module.exports = couponService;