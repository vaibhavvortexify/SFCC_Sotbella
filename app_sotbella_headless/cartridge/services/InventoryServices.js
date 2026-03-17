'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');

var inventoryUpdate = LocalServiceRegistry.createService('sfcc.data.ocapi', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('PATCH');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + params.accessToken);

        // Build endpoint dynamically
        var pref = Site.getCurrent().getPreferences().getCustom();
        var path = 'inventory_lists/' + params.inventoryListID + '/product_inventory_records/' + params.productId;
        svc.setURL(svc.getConfiguration().getCredential().getURL() + path);

        // Prepare request body
        var body = {
            allocation : {
                "amount" : params.allocation 
            }
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
                productId: params.productId,
                allocation: params.allocation,
                message: 'Mock inventory updated successfully'
            })
        }
    }
});

module.exports = {
    inventoryUpdate: inventoryUpdate
}