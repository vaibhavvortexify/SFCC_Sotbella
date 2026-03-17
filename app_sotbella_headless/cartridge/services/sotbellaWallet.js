'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

function getCredentialToken() {
    return Site.getCurrent().getCustomPreferenceValue('walletAPIToken');
}

function getBaseUrl(svc) {
    return svc.configuration.credential.URL;
}

var createCustomer = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());
        svc.setURL(getBaseUrl(svc) + '/customers');

        if (params.payload) {
            return JSON.stringify(params.payload);
        }
        return '';
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
});

var updateCustomer = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('PUT');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());

        var url = getBaseUrl(svc) + '/customers';
        if (params.email) {
            url += '/' + params.email;
        }
        svc.setURL(url);

        if (params.payload) {
            return JSON.stringify(params.payload);
        }
        return '';
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
});

var creditCustomer = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());

        var url = getBaseUrl(svc) + '/wallet';
        if (params.email) {
            url += '/' + params.email + '/credit';
        }
        svc.setURL(url);

        if (params.payload) {
            return JSON.stringify(params.payload);
        }
        return '';
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
});

var debitCustomer = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());

        var url = getBaseUrl(svc) + '/wallet';
        if (params.email) {
            url += '/' + params.email + '/debit';
        }
        svc.setURL(url);

        if (params.payload) {
            return JSON.stringify(params.payload);
        }
        return '';
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
});

var getBalance = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('GET');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());

        var url = getBaseUrl(svc) + '/wallet';
        if (params.email) {
            url += '/' + params.email + '/balance';
        }
        svc.setURL(url);
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            return { error: true, rawResponse: client.text };
        }
    },
});

var getTransactions = LocalServiceRegistry.createService('sotbella.wallet', {
    createRequest: function (svc, params) {
        svc.setRequestMethod('GET');
        svc.addHeader('Accept', 'application/json');
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Authorization', 'Bearer ' + getCredentialToken());

        // Construct Base URL
        var url = getBaseUrl(svc) + '/wallet/' + params.email + '/transactions';
        
        // Build Query Parameters
        var queryParams = [];
        
        // Default to page 1 if not provided
        queryParams.push('page=' + (params.page ? params.page : 1));
        
        // Default to limit 20 if not provided
        queryParams.push('limit=' + (params.limit ? params.limit : 20));
        
        if (params.startDate) {
            queryParams.push('startDate=' + params.startDate);
        }
        
        if (params.endDate) {
            queryParams.push('endDate=' + params.endDate);
        }

        // Append Query String to URL
        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        svc.setURL(url);
        
        Logger.info('Wallet GetTransactions Request URL: {0}', url);
    },
    parseResponse: function (svc, client) {
        try {
            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('Wallet GetTransactions Parse Error: {0}', e.message);
            return { error: true, rawResponse: client.text };
        }
    },
    filterLogMessage: function (msg) {
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    }
});

module.exports = {
    createCustomer: createCustomer,
    updateCustomer: updateCustomer,
    creditCustomer: creditCustomer,
    debitCustomer: debitCustomer,
    getBalance: getBalance,
    getTransactions: getTransactions
};