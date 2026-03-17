'use strict';

var Logger = require('dw/system/Logger');

/**
 * Creates a wallet customer using the given profile data.
 * @param {dw.customer.Profile|Object} profileData - The customer profile or data object.
 * @returns {Object} The service response.
 */

function createWalletCustomer(profileData) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        var genderValue = profileData.gender ? profileData.gender.value : 0;

        var payload = {
            email: profileData.email,
            name: profileData.firstName + ' ' + (profileData.lastName || ''),
            phone: profileData.phoneMobile || profileData.phoneHome || '',
            sfccCustomerId: profileData.customerNo || '',
            dob: profileData.birthday ? profileData.birthday.toISOString().split('T')[0] : '',
            gender: getGenderString(genderValue),
        };

        // If passing a raw object instead of Profile, assume keys match or handle accordingly
        if (!profileData.customerNo && profileData.sfccCustomerId) {
            payload = profileData;
        }

        var result = walletServices.createCustomer.call({
            payload: payload,
        });

        if (result.ok) {
            Logger.info('Wallet customer created successfully for {0}', payload.email);
            return {
                success: true,
                data: result.object,
            };
        }

        Logger.error('Wallet Service Error: ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage,
        };
    } catch (e) {
        Logger.error('Exception in createWalletCustomer: ' + e.message);
        return {
            success: false,
            error: e.message,
        };
    }
}

/**
 * Maps SFCC gender integer to string expected by Wallet API.
 * @param {number} genderValue - SFCC gender value (1=male, 2=female, 0=unspecified).
 * @returns {string} - "male", "female", or "unknown".
 */
function getGenderString(genderValue) {
    if (genderValue === 1) {
        return 'male';
    } else if (genderValue === 2) {
        return 'female';
    }
    return 'unknown';
}

/**
 * Updates a wallet customer using the given profile data.
 * @param {dw.customer.Profile|Object} profileData - The customer profile or data object.
 * @returns {Object} The service response.
 */
function updateWalletCustomer(profileData) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        var genderValue = profileData.gender ? profileData.gender.value : 0;

        var payload = {
            name: profileData.firstName + ' ' + (profileData.lastName || ''),
            phone: profileData.phoneMobile || profileData.phoneHome || '',
            sfccCustomerId: profileData.customerNo || '',
            dob: profileData.birthday ? profileData.birthday.toISOString().split('T')[0] : '',
            gender: getGenderString(genderValue),
            status: 'active',
        };

        // If passing a raw object instead of Profile, assume keys match or handle accordingly
        if (!profileData.customerNo && profileData.sfccCustomerId) {
            payload = profileData;
        }

        var result = walletServices.updateCustomer.call({
            email: profileData.email,
            payload: payload,
        });

        if (result.ok) {
            Logger.info('Wallet customer updated successfully for {0}', profileData.email);
            return {
                success: true,
                data: result.object,
            };
        }

        Logger.error('Wallet Service Error (Update): ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage,
        };
    } catch (e) {
        Logger.error('Exception in updateWalletCustomer: ' + e.message);
        return {
            success: false,
            error: e.message,
        };
    }
}

/**
 * Credits a customer's wallet.
 * @param {string} email - Customer email.
 * @param {number} amount - Amount to credit.
 * @param {string} type - Type of credit (e.g. "reward").
 * @param {string} description - Description.
 * @param {string} remarks - Remarks.
 * @param {string} referenceId - Reference ID.
 * @returns {Object} Service response.
 */
function creditCustomerWallet(email, amount, type, description, remarks, referenceId) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        if (!amount) {
            return {
                success: false,
                error: 'Amount is required',
            };
        }
        var payload = {
            amount: amount,
            type: type || '',
            description: description || '',
            remarks: remarks || '',
            referenceId: referenceId || '',
        };

        var result = walletServices.creditCustomer.call({
            email: email,
            payload: payload,
        });

        if (result.ok) {
            Logger.info('Wallet credited successfully for {0}', email);
            return {
                success: true,
                data: result.object,
            };
        }

        Logger.error('Wallet Credit Error: ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage,
        };
    } catch (e) {
        Logger.error('Exception in creditCustomerWallet: ' + e.message);
        return {
            success: false,
            error: e.message,
        };
    }
}

function debitCustomerWallet(email, amount, type, description, remarks, referenceId) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        if (!amount) {
            return {
                success: false,
                error: 'Amount is required',
            };
        }

        var payload = {
            amount: amount,
            type: type || '',
            description: description || '',
            remarks: remarks || '',
            referenceId: referenceId || '',
        };

        var result = walletServices.debitCustomer.call({
            email: email,
            payload: payload,
        });

        if (result.ok) {
            Logger.info('Wallet debited successfully for {0}', email);
            return {
                success: true,
                data: result.object,
            };
        }

        Logger.error('Wallet Debit Error: ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage,
        };
    } catch (e) {
        Logger.error('Exception in debitCustomerWallet: ' + e.message);
        return {
            success: false,
            error: e.message,
        };
    }
}

/**
 * Retrieves a customer's wallet balance.
 * @param {string} email - Customer email.
 * @param {string} referenceId - Optional reference ID to pass to the API.
 * @returns {Object} Service response with balance data.
 */
function getCustomerWalletBalance(email) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        
        var result = walletServices.getBalance.call({
            email: email
        });

        if (result.ok) {
            Logger.info('Wallet balance retrieved successfully for {0}', email);
            return {
                success: true,
                data: result.object.data
            };
        }

        Logger.error('Wallet GetBalance Error: ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage
        };

    } catch (e) {
        Logger.error('Exception in getCustomerWalletBalance: ' + e.message);
        return {
            success: false,
            error: e.message
        };
    }
}

/**
 * Retrieves a customer's wallet transactions with pagination and date filters.
 * @param {string} email - Customer email.
 * @param {number} [page] - Page number (default 1).
 * @param {number} [limit] - Records per page (default 20).
 * @param {string} [startDate] - Start date (YYYY-MM-DD).
 * @param {string} [endDate] - End date (YYYY-MM-DD).
 * @returns {Object} Service response with transactions data.
 */
function getCustomerWalletTransactions(email, page, limit, startDate, endDate) {
    var walletServices = require('*/cartridge/services/sotbellaWallet');

    try {
        if (!email) {
            return { success: false, error: 'Email is required for fetching transactions.' };
        }

        var params = {
            email: email,
            page: page,
            limit: limit,
            startDate: startDate,
            endDate: endDate
        };

        var result = walletServices.getTransactions.call(params);

        if (result.ok) {
            Logger.info('Wallet transactions retrieved successfully for {0}', email);
            return {
                success: true,
                data: result.object
            };
        }

        Logger.error('Wallet GetTransactions Error: ' + result.errorMessage);
        return {
            success: false,
            error: result.errorMessage
        };

    } catch (e) {
        Logger.error('Exception in getCustomerWalletTransactions: ' + e.message);
        return {
            success: false,
            error: e.message
        };
    }
}
module.exports = {
    createWalletCustomer: createWalletCustomer,
    updateWalletCustomer: updateWalletCustomer,
    creditCustomerWallet: creditCustomerWallet,
    debitCustomerWallet: debitCustomerWallet,
    getCustomerWalletBalance: getCustomerWalletBalance,
    getCustomerWalletTransactions: getCustomerWalletTransactions
};