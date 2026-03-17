var Status = require('dw/system/Status');
var Site = require('dw/system/Site');
var CustomerMgr = require('dw/customer/CustomerMgr');
var Logger = require('dw/system/Logger');

/**
 * - Phone and Email are both required for all regions.
 * - 🇮🇳 India site (sotbella_in / en_IN):
 *     → login = phone
 *     → check that email is unique
 * - 🌍 International sites:
 *     → login = email
 *     → check that phone is unique
 *
 * @param {Object} registration - OCAPI registration payload
 * @returns {dw.system.Status}
 */
function validateInfo(registration) {
    try {
        var currentSite = Site.getCurrent();
        var siteID = currentSite.ID;
        var locale = request.locale;
        var email = registration.customer.email ? registration.customer.email.trim().toLowerCase() : null;
        var login = registration.customer.login ? registration.customer.login.trim().toLowerCase() : null;
        var phone = registration.customer.phoneMobile ? registration.customer.phoneMobile.trim() : null;
        var deviceId = registration.customer.c_deviceId ? registration.customer.c_deviceId.trim().toUpperCase() :null;
        var referralCode = registration.customer.c_referralCode ? registration.customer.c_referralCode.trim():null;
        // ✅ 1. Phone should be required for all sites
        if (!phone) {
            return new Status(
                Status.ERROR,
                'missing_phone',
                'Phone number is required for registration.'
            );
        }
        
        // 🇮🇳 2. India site logic (login = phone)
        if (login) {
            var existingProfile = CustomerMgr.getCustomerByLogin(login);
            if (existingProfile) {
                return new Status(Status.ERROR, 'login_exists', 'This login is already in use by another account.');
            }
        }
        if (siteID === 'sotbella_in' || locale === 'en_IN') {
            // Check if email already exists
            var emailQuery = CustomerMgr.searchProfiles('email = {0}', null, email);
            if (emailQuery.hasNext()) {
                return new Status(Status.ERROR, 'email_exists', 'This email address is already registered.');
            }
            if(login!=phone){
                return new Status(Status.ERROR, 'login_id_mismatch','login should be same as phoneMobile')
            }
        }
        // 🌍 3. International site logic (login = email)
         else {
            // ✅ Check if phone already exists
            var phoneQuery = CustomerMgr.searchProfiles('phoneMobile = {0}', null, phone);
            if (phoneQuery.hasNext()) {
                return new Status(Status.ERROR, 'phone_exists', 'This phone number is already registered.');
            }
            if(login!=email){
                return new Status(Status.ERROR, 'login_id_mismatch','login should be same as email')
            }
        }
        var referralValidation = validateReferralCode(referralCode);
        if (referralValidation.status !== Status.OK) {
            return referralValidation;
        }
        if(referralValidation.status==Status.OK){
            registration.customer.c_referralCode = referralCode;
        }
        // Validate Device Id
        var deviceValidation = checkDeviceIdExists(deviceId);
        if (deviceValidation.status !== Status.OK) {
            return deviceValidation;
        }
        if(deviceValidation.status==Status.OK){
            registration.customer.c_deviceId=deviceId;
        }
      
        var newReferralCode = generateUniqueReferralCode();
        // Attach the referral code to the registration payload so it persists
        registration.customer.c_uniqueReferralCode = newReferralCode;
        registration.customer.c_isVerified = false;
        registration.customer.email = email.trim().toLowerCase();
        registration.customer.login = login.trim().toLowerCase();
        registration.customer.phoneMobile = phone.trim();
        return new Status(Status.OK);
    } catch (error) {
         return new Status(Status.ERROR, 'hook_error', 'An internal error occurred during registration.');
    }   
}

function checkDeviceIdExists(deviceId) {
    if (!deviceId) {
        return new Status(Status.OK);
    }
    var existingProfile = CustomerMgr.searchProfile('custom.deviceId = {0}', deviceId);
    if (existingProfile) {
        return new Status(
            Status.ERROR,
            'device_exists',
            'This device is already registered with another account.'
        );
    }
    return new Status(Status.OK);
}
/**
 * Generate a unique 6-character alphanumeric referral code.
 * Uses CustomerMgr.searchProfile() to ensure uniqueness.
 *
 * @returns {string} unique referral code
 */
function generateUniqueReferralCode() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var code, existingProfile;
    var attempts = 0;

    do {
        attempts = attempts+1;
        code = '';
        for (var i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        existingProfile = CustomerMgr.searchProfile('custom.uniqueReferralCode = {0}', code);

        if (!existingProfile) {
            Logger.info('ReferralCodeGen: generated unique code {0}', code);
            return code;
        }

    } while (attempts < 10);

    throw new Error('Failed to generate unique referral code after multiple attempts.');
}

/**
 * Helper: Validate that a referral code exists and is linked to another customer
 * @param {string} referralCode - Referral code provided by the registering customer
 * @returns {dw.system.Status} - OK if valid, ERROR otherwise
 */
function validateReferralCode(referralCode) {
     if (!referralCode) {
        return new Status(Status.OK); // optional field, so skip if not provided
    }
    referralCode = referralCode.trim().toUpperCase();
    if(referralCode.length<6){
        return new Status(Status.ERROR, 'invalid_referral_format', 'Referral code must be 6 characters.');
    }
    // Check if referral code belongs to an existing profile
    var existingProfile = CustomerMgr.searchProfile('custom.uniqueReferralCode = {0} AND custom.isVerified = true', referralCode);
    if (!existingProfile) {
        return new Status(Status.ERROR, 'invalid_referral', 'Referral code is not valid.');
    }
    return new Status(Status.OK);
}
module.exports = {
    validateInfo:validateInfo,
    generateUniqueReferralCode:generateUniqueReferralCode,
    checkDeviceIdExists:checkDeviceIdExists
}