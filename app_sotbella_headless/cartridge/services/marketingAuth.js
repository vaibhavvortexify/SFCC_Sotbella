'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var marketingAuthService = LocalServiceRegistry.createService('marketingcloud.auth', {
    "createRequest": function (svc, params) {
        svc.setRequestMethod("POST");
        svc.addHeader("Content-Type", "application/json");
        return JSON.stringify({
            grant_type: "client_credentials",
            client_id: params.clientId,
            client_secret: params.clientSecret
        });
    },
    "parseResponse": function (svc, response) {
        var result = JSON.parse(response.text);
        return result.access_token;
    },
    "mockCall": function () {
        return { access_token: "mocked-token", expires_in: 3600 };
    }
});

module.exports = {
    marketingAuthService: marketingAuthService
}