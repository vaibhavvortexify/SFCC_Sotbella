'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var StringUtils = require('dw/util/StringUtils');

var oauthService = LocalServiceRegistry.createService('admin.auth', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');

        var credential = svc.getConfiguration().getCredential();
        var auth = 'Basic ' + StringUtils.encodeBase64(
            credential.getUser() + ':' + credential.getPassword()
        );
        svc.addHeader('Authorization', auth);

        var body = 'grant_type=client_credentials';
        if (params && params.scope) {
            body += '&scope=' + encodeURIComponent(params.scope);
        }

        return body;
    },

    parseResponse: function (svc, client) {
        return JSON.parse(client.text);
    },

    mockCall: function (svc, params) {
        return {
            ok: true,
            object: {
                access_token: 'mock_access_token',
                token_type: 'Bearer',
                expires_in: 3600
            }
        };
    },
    filterLogMessage: function (msg) {
        return msg; // Mask sensitive info if needed
    }
});

module.exports = oauthService;