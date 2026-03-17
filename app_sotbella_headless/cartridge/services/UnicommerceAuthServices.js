'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var System = require('dw/system/System');

/**
 * Calls Unicommerce token API (GET request, password grant)
 * @returns {Object} response object
 */
function getAccessToken() {

    var callbacks = {
        createRequest: function (svc) {
            var credential = svc.getConfiguration().getCredential();

            var orgPrefs = System.getPreferences().getCustom();
            var username = encodeURIComponent(orgPrefs.UnicommerceUsername);
            var password = encodeURIComponent(orgPrefs.UnicommercePassword);
            var baseURL = credential.getURL();

            var fullURL =
                baseURL +
                '?grant_type=password' +
                '&client_id=my-trusted-client' +
                '&username=' + username +
                '&password=' + password;

            svc.setURL(fullURL);
            svc.setRequestMethod('GET');
        },
        parseResponse: function (svc, client) {
            return JSON.parse(client.text);
        },
        mockCall: function () {
            return {
                ok: true,
                object: {
                    access_token: 'mock_access_token',
                    refresh_token: 'mock_refresh_token',
                    expires_in: 36000
                }
            };
        }
    };

    return LocalServiceRegistry.createService('unicommerce.accessToken', callbacks).call();
}

module.exports = {
    getAccessToken: getAccessToken
};
