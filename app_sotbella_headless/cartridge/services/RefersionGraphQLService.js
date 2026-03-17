'use strict';

var Site = require('dw/system/Site');
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var refersionGraphQLService = LocalServiceRegistry.createService('refersion.graphql', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');

        var pref = Site.getCurrent().getPreferences().getCustom();
        svc.addHeader('X-Refersion-Key', pref.refersionGraphqlToken);

        var body = {
            query: params.query
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
                data: {
                    message: 'This is a mock response for testing purposes.'
                }
            })
        };
    }
});

module.exports = refersionGraphQLService;