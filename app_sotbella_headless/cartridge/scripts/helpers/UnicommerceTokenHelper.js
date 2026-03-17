'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Transaction = require('dw/system/Transaction');

/**
 * Reads credential object for storing tokens
 */
function getCredentialObject() {
    var svc = LocalServiceRegistry.createService('unicommerce.accessToken', {});
    return svc.getConfiguration().getCredential();
}

/**
 * Save the token in service credential custom attribute
 */
function saveAccessToken(token) {
    var cred = getCredentialObject();

    Transaction.wrap(function () {
        cred.custom.accessToken = token;
    });
}

/**
 * Get the stored token
 */
function getStoredAccessToken() {
    var cred = getCredentialObject();
    return cred.custom.accessToken || null;
}

module.exports = {
    saveAccessToken: saveAccessToken,
    getStoredAccessToken: getStoredAccessToken
};
