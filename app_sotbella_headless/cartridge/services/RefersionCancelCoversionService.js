'use strict'

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var refersionCancelCoversion = LocalServiceRegistry.createService('refersion.cancelConversion', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');

        var pref = Site.getCurrent().getPreferences().getCustom();
        svc.addHeader('Refersion-Public-Key', pref.refersionClientId);
        svc.addHeader('Refersion-Secret-Key', pref.refersionClientSecret);

        var body = '';

        //@#$%^&*()_)(*&^%$#@!@#$%^&*()_+_)(*&^%$#@#$%^&*()_)(*&^%$#@!@#$%^&*()_+
        // TO DO 
        //@#$%^&*()_)(*&^%$#@!@#$%^&*()_+_)(*&^%$#@#$%^&*()_)(*&^%$#@!@#$%^&*()_+
        // Currently the body is not sure what to send for cancelling conversion. 
        // The body in the documentation is buggy and returns wrong response.
        // Need to confirm with Refersion support about the correct body to send.
        // So leaving it blank for now.
        // Will update once confirmed.
        //@#$%^&*()_)(*&^%$#@!@#$%^&*()_+_)(*&^%$#@#$%^&*()_)(*&^%$#@!@#$%^&*()_+

        return body;
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
    mockCall: function (scv, params) {
        return {
            statusCode: 200,
            statusMessage: 'OK',
            msg: 'Success'
        }
    }
})

module.exports = refersionCancelCoversion;