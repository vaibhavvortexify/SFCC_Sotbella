'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var System = require('dw/system/System');

function getInventoryUpdates(lastNMinutes, skuIds, accessToken) {

    var callbacks = {
        createRequest: function (svc) {
            var orgPrefs = System.getPreferences().getCustom();

            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Facility', orgPrefs.UnicommerceFacility); 

            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/inventory/inventorySnapshot/get';
            svc.setURL(fullURL);

            var minutes = typeof lastNMinutes === 'number' ? lastNMinutes : parseInt(lastNMinutes, 10);

            var body = {};
            if(minutes > 0) {
                body = {
                    "updatedSinceInMinutes": minutes
                }
            } else if ( skuIds && typeof skuIds === 'string' && skuIds.length > 0) {
                var len = skuIds.length;
                skuIdArray = skuIds.split(',').map(function(item) { return item.trim(); });
                body = {
                    "itemTypeSKUs": skuIdArray
                }
            }else {
                Array.isArray(skuIds) && skuIds.length > 0 ? body = {
                    "itemTypeSKUs": skuIds
                } : body = {};
            }
            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            return JSON.parse(client.text);
        },
        mockCall: function () {
            return {
                ok: true,
                object: {
                    saleOrderCode: 'SO123456',
                    status: 'Created'
                }
            };
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}

module.exports = {
    getInventoryUpdates: getInventoryUpdates
};