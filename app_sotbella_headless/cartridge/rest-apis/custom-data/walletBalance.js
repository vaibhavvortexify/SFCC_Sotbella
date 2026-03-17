'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var CustomerMgr = require('dw/customer/CustomerMgr');
var WalletHelper = require('*/cartridge/scripts/helpers/walletHelper'); 

/**
 * Custom API Endpoint: Get Wallet Balance
 * Path: /walletBalance
 * Method: GET
 */
exports.getWalletBalance = function () {
    try {
        // 1. Validate Site ID
        var siteId = request.httpParameterMap.siteId.stringValue;
        if (siteId !== 'sotbella_in') {
            return RESTResponseMgr.createError(
                400,
                'BadRequest',
                'Invalid Site ID',
                'This API is only available for sotbella_in'
            ).render();
        }

        // 2. Validate Logged-in Customer
        if (!customer.isAuthenticated() || !customer.getProfile()) {
            return RESTResponseMgr.createError(
                401,
                'Unauthorized',
                'User not logged in',
                'You must be logged in to check wallet balance'
            ).render();
        }

        // 3. Get Email from Profile
        var email = customer.getProfile().getEmail();
        if (!email) {
            return RESTResponseMgr.createError(
                400,
                'BadRequest',
                'Email Missing',
                'Customer profile does not have a valid email'
            ).render();
        }

        // 4. Call Helper
        var result = WalletHelper.getCustomerWalletBalance(email);

        // 5. Render Response
        if (result.success) {
            // Wraps the data in a standard success response structure
            RESTResponseMgr.createSuccess({
                success: true,
                data: result.data // Contains email, balance, currency, etc.
            }).render();
        } else {
            RESTResponseMgr.createError(
                500,
                'ServiceError',
                'Wallet Balance Fetch Failed',
                result.error || 'Unknown error retrieving balance'
            ).render();
        }

    } catch (error) {
        Logger.error('Error in getWalletBalance API: {0}', error.message);
        RESTResponseMgr.createError(
            500,
            'InternalServerError',
            'Internal Server Error',
            error.message
        ).render();
    }
};

exports.getWalletBalance.public = true;