'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');
var CustomerMgr = require('dw/customer/CustomerMgr');
var Site = require('dw/system/Site');
/**
 * Generate a random 4-digit numeric OTP.
 * @returns {string} OTP - 4 digit code as string.
 */
function generateFourDigitOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}
/**
 * Create or update an entry in the loginCredsMapper custom object.
 *
 * @param {string} token - The passwordless token from external system (8-digit)
 * @param {string} loginId - The customer's email or phone
 * @returns {string} fourDigitCode - The generated 4-digit OTP
 */
function createLoginCredsMapperEntry(token, loginId, siteId) {
    var otp = generateFourDigitOTP();
    var customObj;
    var attempts = 0;
    try {
        // Ensure unique key — retry if code already exists
        Transaction.wrap(function name(params) {
            do {
                otp = generateFourDigitOTP();
                customObj = CustomObjectMgr.getCustomObject('loginCredsMapper', otp);
                attempts++;
            } while (customObj && attempts < 5);

            var newObj = CustomObjectMgr.createCustomObject('loginCredsMapper', otp);
            newObj.custom.passwordLessToken = token;
            newObj.custom.loginId = loginId;
            newObj.custom.siteId = siteId;
        });
    } catch (error) {
        throw error;
    }
    return otp;
}

/**
 * Helper to validate OTP (check if entry exists and matches loginId)
 *
 * @param {string} otpCode
 * @param {string} loginId
 * @returns {boolean}
 */
function validateOTP(otpCode, loginId, siteId) {
    var obj = CustomObjectMgr.getCustomObject('loginCredsMapper', otpCode);
    if (!obj) {
        Logger.warn('OTP validation failed: no entry found for {0}', otpCode);
        return false;
    }
    if (obj.custom.loginId !== loginId) {
        Logger.warn('OTP validation failed: loginId mismatch for {0}', otpCode);
        return false;
    }
    if (obj.custom.siteId !== siteId) {
        Logger.warn(
            'OTP validation failed: siteId mismatch for {0}. Expected {1}, got {2}',
            otpCode,
            obj.custom.siteId,
            siteId
        );
        return false;
    }
    return true;
}

/**
 * Helper to fetch 8 digit token
 *
 * @param {string} otpCode
 */
function getLoginToken(otpCode) {
    var obj = CustomObjectMgr.getCustomObject('loginCredsMapper', otpCode);
    if (!obj) {
        return null;
    }
    return obj.custom.passwordLessToken;
}

/**
 * Deletes a custom object entry by OTP and loginId if both match.
 * @param {string} otp - 4-digit OTP code
 * @param {string} loginId - Customer's login identifier (email/phone)
 */
function clearOTPEntry(otp, loginId) {
    if (!otp || !loginId) {
        return false;
    }
    var customObject = CustomObjectMgr.getCustomObject('loginCredsMapper', otp);
    if (!customObject) {
        return false;
    }
    var storedLoginId = customObject.custom.loginId;
    if (storedLoginId === loginId) {
        Transaction.wrap(function () {
            CustomObjectMgr.remove(customObject);
        });
        return true;
    }
    return false;
}
/**
 * Marks a customer as verified.
 * @param {string} login_id - The customer's loginid
 */
function markCustomerVerified(login_id) {
    if (!login_id) {
        return false;
    }
    var customer = CustomerMgr.getCustomerByLogin(login_id);
    if (!customer) {
        return false;
    }
    Transaction.wrap(function () {
        customer.profile.custom.isVerified = true;
    });
    return true;
}

/**
 * Handles the referral code linking logic after a customer's successful login.
 * * 1. Fetches the logging-in customer ('referredCustomer').
 * 2. Checks if 'referredCustomer.profile.custom.referralCode' is present AND
 * 'referredCustomer.profile.custom.referredByCustomer' is empty.
 * 3. If so, fetches a second customer ('referrerCustomer') whose
 * 'profile.custom.uniqueReferralCode' matches the first customer's 'referralCode',
 * AND whose 'profile.custom.isVerified' is true.
 * 4. If 'referrerCustomer' exists, updates 'referredCustomer' with the referrer's login,
 * and increments 'referrerCustomer.profile.custom.referredUsersCount'.
 * * @param {string} referredCustomerLogin - The login of the customer who just logged in.
 */
function handleReferralLinking(referredCustomerLogin) {
    if (!referredCustomerLogin) {
        Logger.warn('handleReferralLinking failed: No login ID provided.');
        return;
    }

    var referredCustomer = CustomerMgr.getCustomerByLogin(referredCustomerLogin);
    if (!referredCustomer) {
        Logger.warn('handleReferralLinking failed: Could not find customer with login {0}', referredCustomerLogin);
        return;
    }

    var referralCode = referredCustomer.profile.custom.referralCode;
    var referredByCustomer = referredCustomer.profile.custom.referredByCustomer;

    // Check conditions: referralCode must exist AND referredByCustomer must be empty.
    if (referralCode && !referredByCustomer) {
        // Search for the referrer customer
        var searchQuery = 'custom.uniqueReferralCode = {0} AND custom.isVerified = true';
        var customerIter = CustomerMgr.searchProfiles(
            'custom.uniqueReferralCode = {0} AND custom.isVerified = true',
            null,
            referralCode
        );

        try {
            if (customerIter.hasNext()) {
                var referrerProfile = customerIter.next();
                var referrerCustomer = referrerProfile.getCustomer();

                var referralReward = Site.getCurrent().getCustomPreferenceValue('referralReward');
                if (referrerCustomer && referralReward) {
                    // Start transaction to update both customers
                    var WalletHelper = require('*/cartridge/scripts/helpers/walletHelper');
                    var currentCount = referrerCustomer.profile.custom.referredUsersCount || 0;
                    var referral = JSON.parse(referralReward);
                    var amountCredit = true;
                    if (currentCount + 1 == referral.referralThreshold) {
                        // Credit the referrer
                        var creditResponse = WalletHelper.creditCustomerWallet(
                            referrerCustomer.profile.email,
                            referral.rewardAmount,
                            'bonus',
                            'Referral Bonus',
                            'Referral Bonus',
                            referredCustomer.profile.customerNo || ''
                        );
                        if (creditResponse.error) {
                            amountCredit = false;
                        }
                    }
                    Transaction.wrap(function () {
                        if (currentCount < referral.referralThreshold && amountCredit) {
                            // 1. Store the referrer's login in the referred customer's profile
                            referredCustomer.profile.custom.referredByCustomer = referrerCustomer.profile.customerNo;
                            // 2. Increase the referredUsersCount on the referrer's profile
                            referrerCustomer.profile.custom.referredUsersCount = currentCount + 1;
                        }
                    });
                } else {
                    Logger.warn(
                        'Referral Search: Found a profile but could not get customer object for referralCode {0}',
                        referralCode
                    );
                }
            } else {
                Logger.info('Referral Search: No verified referrer found for code {0}', referralCode);
            }
        } catch (e) {
            Logger.error('Referral Linking Error for login {0}: {1}', referredCustomerLogin, e.message);
        } finally {
            if (customerIter) {
                customerIter.close();
            }
        }
    }
}

module.exports = {
    createLoginCredsMapperEntry: createLoginCredsMapperEntry,
    validateOTP: validateOTP,
    getLoginToken: getLoginToken,
    clearOTPEntry: clearOTPEntry,
    markCustomerVerified: markCustomerVerified,
    handleReferralLinking: handleReferralLinking,
};
