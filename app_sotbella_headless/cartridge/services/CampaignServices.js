'use strict';

var Site = require('dw/system/Site');
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var campaignGetService = LocalServiceRegistry.createService('sfcc.campaign.get', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('GET');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + params.accessToken);

        var pref = Site.getCurrent().getPreferences().getCustom();
        var path = pref.organizationID + '/campaigns/' + params.campaignId + '?siteId=' + params.siteId;
        svc.setURL(svc.getConfiguration().getCredential().getURL() + path);

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
                campaignId: params.campaignId,
                name: 'Mock Campaign',
                description: 'This is a mock campaign for testing purposes.'
            })
        };
    }

});


var campaignUpdateService = LocalServiceRegistry.createService('sfcc.campaign.update', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('PATCH');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + params.accessToken);

        var pref = Site.getCurrent().getPreferences().getCustom();
        var path = pref.organizationID + '/campaigns/' + params.campaignId + '?siteId=' + params.siteId;
        svc.setURL(svc.getConfiguration().getCredential().getURL() + path);

        var body = {
            coupons: params.coupons
        }

        return JSON.stringify(body);
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
                campaignId: params.campaignId,
                coupons: params.coupons,
                message: 'Mock campaign updated successfully'
            })
        };
    }
});

module.exports = {
    campaignGetService: campaignGetService,
    campaignUpdateService: campaignUpdateService
};