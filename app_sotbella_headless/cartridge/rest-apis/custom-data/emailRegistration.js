/* eslint-disable require-jsdoc */
'use strict';

var Site = require('dw/system/Site');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger'); 

// Import your services
var marketingAuthService = require('*/cartridge/services/marketingAuth.js');
var marketingEmailRegistration = require('*/cartridge/services/marketingEmailRegistration.js');

var logger = Logger.getLogger('CustomAPI', 'HeadlessUtility');

// var EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
    return email && typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

exports.registerEmailHelper = function () {
    try { 
        // var requestBody = request.httpParameterMap.requestBodyAsString;
        var requestBody = request.httpParameterMap.requestBodyAsString;


        if (!requestBody) {
            return {
                success: false,
                message: 'Request body is required',
                details: { error: 'Empty request body' }
            };
        }

        var requestJSON;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            return {
                success: false,
                message: 'Invalid JSON format',
                details: { error: 'Failed to parse request body' }
            };
        }

        var email = requestJSON.email;

        // Validate email
        if (!email) {
            return {
                success: false,
                message: 'Email is required',
                details: { error: 'Missing email parameter' }
            };
        }

        // Trim and validate email format
        email = email.trim().toLowerCase();

        if (!isValidEmail(email)) {
            return {
                success: false,
                message: 'Invalid email format',
                details: { error: 'Email does not match valid format' }
            };
        }

        // Get Marketing Cloud credentials from site preferences
        var currentSitePref = Site.getCurrent().getPreferences().getCustom();
        var clientId = currentSitePref.marketingCloudClientId;
        var clientSecret = currentSitePref.marketingCloudClientSecret;

        // var clientId = 'p18zsxy2b6m2bze4ne6syki4';
        // var clientSecret = 'yMWwUeWYDlihLRjjLXjIB0IH';

        if (!clientId || !clientSecret) {
            logger.error('Marketing Cloud credentials not configured');
            return {
                success: false,
                message: 'Service configuration error',
                details: { error: 'Marketing Cloud credentials not found' }
            };
        }

        logger.info('Starting email registration process for: ' + email);

        // Step 1: Get access token from Marketing Cloud
        var authResult = marketingAuthService.marketingAuthService.call({
            clientId: clientId,
            clientSecret: clientSecret
        });

        if (!authResult.ok) {
            logger.error('Marketing Cloud auth failed: ' + authResult.error);
            return {
                success: false,
                message: 'Authentication failed',
                details: {
                    error: 'Failed to authenticate with Marketing Cloud',
                    statusCode: authResult.status,
                    errorMessage: authResult.errorMessage
                }
            };
        }

        var accessToken = authResult.object;

        if (!accessToken) {
            logger.error('No access token received from Marketing Cloud');
            return {
                success: false,
                message: 'Authentication failed',
                details: { error: 'No access token received' }
            };
        }

        logger.info('Successfully obtained Marketing Cloud access token');

        // Step 2: Register email in Marketing Cloud Data Extension
        var registrationResult = marketingEmailRegistration.marketingEmailRegistration.call({
            token: accessToken,
            email: email,
            siteId: Site.getCurrent().getID()
        });

        if (!registrationResult.ok) {
            logger.error('Email registration failed: ' + registrationResult.error);
            return {
                success: false,
                message: 'Email registration failed',
                details: {
                    error: 'Failed to register email in Marketing Cloud',
                    statusCode: registrationResult.status,
                    errorMessage: registrationResult.errorMessage
                }
            };
        }

        logger.info('Successfully registered email: ' + email);

        return {
            success: true,
            message: 'Email registered successfully',
            details: {
                email: email,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        logger.error('Unexpected error in email registration: ' + error.message);
        return {
            success: false,
            message: 'Internal server error',
            details: { error: error.message }
        };
    }
}; 
exports.registerEmail = function () {
    try {
        var result = exports.registerEmailHelper();

        if (result.success) {
            RESTResponseMgr.createSuccess(result).render();
        } else {
            RESTResponseMgr.createSuccess(result).render(); 
        }
        
    } catch (error) {
        logger.error('Error in registerEmail: {0}', error.message);
        RESTResponseMgr.createSuccess({error_code: 500, msg: 'Internal Server Error !'}).render(); 
    }
};
exports.registerEmail.public = true;