'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var CustomerMgr = require('dw/customer/CustomerMgr');
var WalletHelper = require('*/cartridge/scripts/helpers/walletHelper'); 

/**
 * Custom API Endpoint: Get Wallet Transactions
 * Path: /walletTransactions
 * Method: POST
 */
exports.getWalletTransactions = function () {
    try {
        // 1. Validate Site ID (Query Param)
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
                'You must be logged in to view wallet transactions'
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

        // 4. Parse Request Body
        var body = {};
        var requestBodyAsString = request.httpParameterMap.requestBodyAsString;
        
        if (requestBodyAsString) {
            try {
                body = JSON.parse(requestBodyAsString);
            } catch (e) {
                return RESTResponseMgr.createError(
                    400,
                    'BadRequest',
                    'Invalid JSON',
                    'Request body is not valid JSON'
                ).render();
            }
        }

        // 5. Extract Parameters from Body
        var page = body.page || 1;
        var limit = body.limit || 20;
        var startDate = body.startDate || null;
        var endDate = body.endDate || null;

        // 6. Call Existing Helper
        var result = WalletHelper.getCustomerWalletTransactions(email, page, limit, startDate, endDate);

        // 7. Render Response
        if (result.success) {
            RESTResponseMgr.createSuccess(result.data).render();
        } else {
            RESTResponseMgr.createError(
                500,
                'ServiceError',
                'Wallet Service Failed',
                result.error || 'Unknown error fetching transactions'
            ).render();
        }

    } catch (error) {
        Logger.error('Error in getWalletTransactions API: {0}', error.message);
        RESTResponseMgr.createError(
            500,
            'InternalServerError',
            'Internal Server Error',
            error.message
        ).render();
    }
};

exports.getWalletTransactions.public = true;