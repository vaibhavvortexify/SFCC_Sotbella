'use strict';

var Status = require('dw/system/Status');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

exports.beforePATCH = function (customer, customerInput) {
    try {
        if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
            return;
        }
        if (!customerInput.lastName) {
            return new Status(
                Status.ERROR,
                'MISSING_LAST_NAME',
                'The Last Name field is required and cannot be left blank.'
            );
        }
        if (!customerInput.firstName) {
            return new Status(
                Status.ERROR,
                'MISSING_FIRST_NAME',
                'The First Name field is required and cannot be left blank.'
            );
        }

        var rawJsonPayload = JSON.parse(request.httpParameterMap.requestBodyAsString);
        var allowedKeys = Site.current.getCustomPreferenceValue('updateCustomerAllowedKeys');
        if (!allowedKeys) {
            return new Status(Status.ERROR, 'ALLOWED_KEYS_NOTFOUND', 'Allowed keys custom prefrence not found.');
        }
        allowedKeys = JSON.parse(allowedKeys);
        var invalidKeys = Object.keys(rawJsonPayload).filter(function (key) {
            return !allowedKeys.includes(key);
        });

        if (invalidKeys.length > 0) {
            return new Status(
                Status.ERROR,
                'CONTAINS_INVALID_KEYS',
                'The request contains fields that cannot be updated: ' + invalidKeys.join(', ')
            );
        }
        if (rawJsonPayload.birthday === null) {
            return new Status(Status.ERROR, 'BIRTHDATE_INVALID', 'Birth date must be entered.');
        }
        if (customer.getProfile().getBirthday() && customerInput.birthday) {
            return new Status(
                Status.ERROR,
                'BIRTHDATE_IMMUTABLE',
                'The recorded birth date cannot be changed once it has been set.'
            );
        }

        return new Status(Status.OK);
    } catch (error) {
        Logger.error('Unexpected error in Newsletter Subs: ' + error.message);
    }
};

exports.afterPATCH = function (customer, customerInput) {
    if (!request.isSCAPI() && request.getClientId() != 'dw.csc') {
        return;
    }
    // Wallet Update Logic
    try {
        var WalletHelper = require('*/cartridge/scripts/helpers/walletHelper');
        if (customer && customer.profile) {
            Logger.info('Triggering wallet update for customer: {0}', customer.profile.customerNo);
            WalletHelper.updateWalletCustomer(customer.profile);
        }
    } catch (e) {
        Logger.error('Error in afterPATCH wallet hook: {0}', e.message);
    }

    if (customerInput.c_newsletterSubscribed === true || customerInput.c_newsletterSubscribed === false) {
        if (!customerInput.email) {
            return;
        }

        var marketingAuthService = require('*/cartridge/services/marketingAuth.js');
        var marketingEmailRegistration = require('*/cartridge/services/marketingEmailRegistration.js');
        try {
            var currentSitePref = Site.getCurrent().getPreferences().getCustom();
            var clientId = currentSitePref.marketingCloudClientId;
            var clientSecret = currentSitePref.marketingCloudClientSecret;

            if (!clientId || !clientSecret) {
                Logger.error('Marketing Cloud credentials not configured');
                throw new Error('Marketing Cloud credentials not configured');
            }
            var authResult = marketingAuthService.marketingAuthService.call({
                clientId: clientId,
                clientSecret: clientSecret,
            });

            if (!authResult.ok) {
                Logger.error('Marketing Cloud auth failed: ' + authResult.error);
                throw new Error('Marketing Cloud auth failed: ' + authResult.error);
            }
            var accessToken = authResult.object;
            if (!accessToken) {
                Logger.error('No access token received from Marketing Cloud');
                throw new Error('No access token received from Marketing Cloud');
            }

            var registrationResult = marketingEmailRegistration.marketingEmailRegistration.call({
                token: accessToken,
                email: customerInput.email,
                phoneNumber: customerInput.phoneMobile,
                emailOptIn: customerInput.c_newsletterSubscribed,
            });

            if (!registrationResult.ok) {
                Logger.error('Newsletter Subs failed: ' + registrationResult.error);
                throw new Error('Newsletter Subs failed: ' + registrationResult.error);
            }
        } catch (error) {
            Logger.error('Unexpected error in Newsletter Subs: ' + error.message);
        }
    }

    return new Status(Status.OK);
};

exports.afterPOST = function (customer) {
    var WalletHelper = require('*/cartridge/scripts/helpers/walletHelper');

    try {
        if (!customer || !customer.profile) {
            return;
        }
        Logger.info('Triggering wallet creation for customer: {0}', customer.profile.customerNo);

        WalletHelper.createWalletCustomer(customer.profile);
    } catch (e) {
        Logger.error('Error in afterPOST wallet hook: {0}', e.message);
    }
};
