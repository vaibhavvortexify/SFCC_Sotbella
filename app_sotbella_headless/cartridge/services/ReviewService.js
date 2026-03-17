'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var System = require('dw/system/System'); // Imported System for Global Preferences
var Logger = require('dw/system/Logger');

/**
 * Service to check if a review exists for a specific product and user email.
 * Service ID: 'sotbella.reviews.exists'
 */
var checkReviewExists = LocalServiceRegistry.createService('digiiq.reviews', {
    createRequest: function (svc, params) {
        try {
            // --- UPDATED: Fetch from Global Custom Preferences ---
            var globalPrefs = System.getPreferences().getCustom();
            var merchantId = globalPrefs['reviewsMerchantId'];
            var apiKey = globalPrefs['reviewsApiKey'];

            // Validation to ensure prefs exist
            if (!merchantId || !apiKey) {
                throw new Error('Missing Global Custom Preferences: reviewsMerchantId or reviewsApiKey');
            }

            // 1. Set Method
            svc.setRequestMethod('GET');

            // 2. Build URL
            // Base URL from Service Credential
            var url = svc.configuration.credential.URL;
            url+='/reviews/exists';
            // Append Query Parameters
            url += '?merchantId=' + encodeURIComponent(merchantId);
            url += '&productId=' + encodeURIComponent(params.productId);
            url += '&authorEmail=' + encodeURIComponent(params.authorEmail);

            svc.setURL(url);

            // 3. Set Headers
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('X-Merchant-Id', merchantId);
            svc.addHeader('x-api-key', apiKey);

            Logger.info('ReviewExistsService - Request URL: {0}', url);
            
            return ""; // GET request has no body
        } catch (error) {
            Logger.error('ReviewExistsService - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ReviewExistsService - Response status: {0}', client.statusCode);
            var responseText = client.text;
            
            // Parse JSON response
            if (responseText) {
                return JSON.parse(responseText);
            }
            return { error: true, message: 'Empty response body' };

        } catch (e) {
            Logger.error('ReviewExistsService - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON response from Reviews API' };
        }
    },

    filterLogMessage: function (msg) {
        return msg; 
    },

    mockCall: function () {
        return {
            exists: true,
            reviewId: "mock-review-123"
        };
    }
});

module.exports = {
    checkReviewExists: checkReviewExists
};