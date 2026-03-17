'use strict'
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var Bytes = require('dw/util/Bytes');
var Encoding = require('dw/crypto/Encoding');
var getAccessToken = LocalServiceRegistry.createService('auth.passwordlessLogin', {
    createRequest: function (svc, params) {
        try {
		var clientId = Site.current.getCustomPreferenceValue('private_client_id');
        var clientSecret = Site.current.getCustomPreferenceValue('private_client_secret');
        var redirectUri = Site.current.getCustomPreferenceValue('redirect_uri');
        var organizationId = Site.current.getCustomPreferenceValue('organization_id')
        if (!clientId || !clientSecret || !organizationId) {
                throw new Error('Missing required site preferences (clientId, clientSecret, or organizationId)');
        }
        // Build Basic Auth header
            var authString = clientId + ':' + clientSecret;
            var base64Auth = Encoding.toBase64(new Bytes(authString, 'UTF-8'));
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL+'/shopper/auth/v1/organizations/'+organizationId +'/oauth2/passwordless/token');
             svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');
            svc.addHeader('Authorization', 'Basic ' + base64Auth);

              // Static params
            var grantType = 'client_credentials';
            var hint = 'pwdless_login';

            // Required dynamic params
            var pwdless_login_token = params.pwdless_login_token;
            var usid = params.usid;
            var payload =
                'grant_type=' + encodeURIComponent(grantType) +
                '&redirect_uri=' + encodeURIComponent(redirectUri) +
                '&hint=' + encodeURIComponent(hint) +
                '&pwdless_login_token=' + encodeURIComponent(pwdless_login_token) +
                '&usid=' + encodeURIComponent(usid);

            Logger.info('PasswordlessTokenService - Payload: {0}', payload);

            return payload;
        } catch (error) {
            Logger.error('PasswordlessTokenService - Error building request: {0}', error.message);
            throw error;
        }
    },
    parseResponse: function (svc, client) {
        try {
            var responseText = client.text;
            Logger.info('PasswordlessTokenService - Response Code: {0}', client.statusCode);

            if (responseText && responseText.length > 2000) {
                Logger.info('PasswordlessTokenService - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('PasswordlessTokenService - Full Response: {0}', responseText);
            }

            return JSON.parse(responseText);
        } catch (e) {
            Logger.error('PasswordlessTokenService - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from passwordless token API' };
        }
    },
    filterLogMessage: function (msg) {
        // Mask the Authorization header in logs
        return msg.replace(/Basic\s+[A-Za-z0-9\+\/\=\-]+/, 'Basic ***');
    },
    mockCall: function () {
        return {
            status_code: 200,
            access_token: 'mock_token_123456',
            token_type: 'Bearer',
            expires_in: 3600
        };
    }
})

module.exports = {
    getAccessToken:getAccessToken
}
