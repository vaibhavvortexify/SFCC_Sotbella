'use strict';

var Site = require('dw/system/Site');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');

exports.getPayPalSDKConfigData = function () {
    var site = Site.getCurrent();
    var preferences = site.getPreferences().getCustom();
    var currency = request.httpParameterMap.c_currency.stringValue || site.getDefaultCurrency();
    //var currency = 'USD';
    if (!preferences.paypalClientId) {
        return {
            success: false,
            message: 'PayPal client ID is not configured.'
        };
    }

    return {
        success: true,
        clientId: preferences.paypalClientId,
        currency: currency,
        intent: 'capture',
        components: 'buttons',
        commit: true,
        sdkBaseUrl: 'https://www.paypal.com/sdk/js'
    };
};

exports.getPayPalSDKConfig = function () {
    RESTResponseMgr.createSuccess(exports.getPayPalSDKConfigData()).render();
};

exports.getPayPalSDKConfig.public = true;
