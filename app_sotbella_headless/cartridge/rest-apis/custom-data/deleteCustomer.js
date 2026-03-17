'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var CustomerMgr = require('dw/customer/CustomerMgr');
var Transaction = require('dw/system/Transaction');

/**
 * Helper to validate customer status and perform deletion
 */
exports.deleteCustomerHelper = function () {
    // 1. Check if global customer object exists and is authenticated
    if (!customer || !customer.authenticated) {
        return {
            success: false,
            statusCode: 401,
            message: 'Unauthorized: You must be logged in to perform this action.',
            details: { error: 'Customer not authenticated' }
        };
    }

    // 2. Check if customer is registered (Anonymous users cannot be "deleted" in this context)
    if (!customer.registered) {
        return {
            success: false,
            statusCode: 401,
            message: 'Unauthorized: Only registered customers can delete their account.',
            details: { error: 'Customer is not registered' }
        };
    }

    try {
        var customerNo = customer.profile.customerNo; // Capture ID for logging before deletion

        // 3. Perform Deletion
        // removeCustomer requires a transaction as it modifies DB records
        Transaction.wrap(function () {
            CustomerMgr.removeCustomer(customer);
        });

        Logger.info('Successfully deleted customer account: ' + customerNo);

        return {
            success: true,
            statusCode: 200,
            message: 'Customer account deleted successfully.'
        };

    } catch (e) {
        Logger.error('Error deleting customer: ' + e.message);
        return {
            success: false,
            statusCode: 500,
            message: 'An error occurred while deleting the account.',
            details: { error: e.message }
        };
    }
};

/**
 * Handles the deleteCustomer API.
 *
 * @param {Object} context - Headless API context
 * @returns {Object} JSON response
 */
exports.deleteCustomer = function () {
    try {
        var result = exports.deleteCustomerHelper();

        if (result.success) {
            RESTResponseMgr.createSuccess({
                success: true,
                message: result.message
            }).render();
        } else {
            RESTResponseMgr.createError(
                result.statusCode,          // statusCode
                'Error',                    // type
                result.message,             // title
                result.details ? result.details.error : result.message
            ).render();
        }
    } catch (error) {
        Logger.error('Unexpected error in deleteCustomer: {0}', error.message);
        RESTResponseMgr.createError(
            500,
            'InternalServerError',
            'Internal Server Error',
            error.message || 'Unexpected error occurred'
        ).render();
    }
};

exports.deleteCustomer.public = true;