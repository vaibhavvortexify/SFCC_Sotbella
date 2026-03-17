'use strict';
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

function getSaleOrder(orderNo, accessToken) {
    var callbacks = {
        createRequest: function (svc) {
            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/oms/saleorder/get';
            svc.setURL(fullURL);

            var body = {
                "code": orderNo
            }

            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            try {
                return JSON.parse(client.text);
            } catch (e) {
                return {};
            }
        },
        mockCall: function () {
            return {
                "successful": true,
                "message": null,
                "errors": [],
            }
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}

module.exports = getSaleOrder;