'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var TokenHelper = require('*/cartridge/scripts/helpers/PasswordLessTokenHelper.js');
var TokenService = require('*/cartridge/services/LoginService.js');
var CustomerMgr = require('dw/customer/CustomerMgr');
var EmailHelper = require('*/cartridge/scripts/helpers/emailHelper');
var registerCustomerHelper = require('*/cartridge/scripts/helpers/RegisterCustomerHelper');
var Transaction = require('dw/system/Transaction');
exports.passwordlessLoginHelper = function () {
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
    }
    catch (parseError) {
        return {
            success: false,
            message: 'Invalid JSON format',
            details: { error: 'Failed to parse request body' }
        };
    }
    var fourDigitCode = requestJSON.pwdless_login_token;
    var usid = requestJSON.usid;
    var login_id = requestJSON.login_id
    var siteId = request.httpParameterMap.siteId.stringValue; 
    var deviceId = requestJSON.deviceId;
    if (!/^\d{4}$/.test(fourDigitCode)) {
        return {
            success: false,
            message: 'pwdless_login_token must contain 4 digits only',
            details: {
                error: 'pwdless_login_token must contain 4 digits only'
            }
        }
    }
    var isValidOTP = TokenHelper.validateOTP(fourDigitCode, login_id,siteId);
    if (!isValidOTP) {
        return {
            success: false,
            message: 'Invalid OTP or loginId mismatch',
            details: { error: 'OTP validation failed' }
        };
    }
    var passwordLessToken = TokenHelper.getLoginToken(fourDigitCode)
    var passwordLessToken = fourDigitCode;
    if (!passwordLessToken) {
        return {
            success: false,
            message: 'Invalid OTP, OTP is expired or something',
            details: { error: 'OTP Verification failed' }
        }
    }
    // Call the passwordless token service
    var serviceResult = TokenService.getAccessToken.call({
        usid: usid,
        pwdless_login_token: passwordLessToken
    });
    if (!serviceResult.ok) {
        Logger.error('Passwordless token service failed: ' + serviceResult.errorMessage);
        var parsedErrorMessage;
        try {
            parsedErrorMessage = JSON.parse(serviceResult.errorMessage);
        } catch (e) {
            parsedErrorMessage = { rawError: serviceResult.errorMessage };
        }

        return {
            success: false,
            message: 'Passwordless token service call failed',
            details: {
                error: parsedErrorMessage.message
            }
        };
    }
    var serviceResponse = serviceResult.object;
    
    TokenHelper.clearOTPEntry(fourDigitCode, login_id);
        // ✅ Mark customer as verified
    if (login_id) {
        var customerObj = CustomerMgr.getCustomerByLogin(login_id);     
        if (customerObj && customerObj.getProfile()) {
            var profile = customerObj.getProfile();
            if(deviceId){
                if(!profile.custom.deviceId){
                     if(registerCustomerHelper.checkDeviceIdExists(deviceId).status==Status.OK){
                        Transaction.wrap(function(){
                            profile.custom.deviceId = deviceId
                        })
                     }
                     else{
                        return {
                            success: false,
                            message: 'Device ID already associated with another account',
                            details: { error: 'Device ID conflict' }
                        }
                     }
                }
            }
            if(!profile.custom.isVerified){
                try {
                    EmailHelper.sendWelcomeEmail(profile.getEmail(),profile.getPhoneMobile(),profile.getFirstName(),profile.getLastName());
                    Logger.info('First time login: Welcome email sent to {0}', login_id);
                 } catch (emailError) {
                    Logger.error('Failed to send welcome email: {0}', emailError.message);
                 }
            }
        }
        TokenHelper.markCustomerVerified(login_id);
        TokenHelper.handleReferralLinking(login_id);
    }
    var customerDetails = {
        firstName: null,
        lastName: null,
        email: null,
        phoneMobile: null
    };
     if (login_id) {
        // Assuming login_id is the user's login (email or phone used for login)
        var customerObj = CustomerMgr.getCustomerByLogin(login_id);
        
        if (customerObj && customerObj.getProfile()) {
            var profile = customerObj.getProfile();
            customerDetails.firstName = profile.getFirstName();
            customerDetails.lastName = profile.getLastName();
            customerDetails.email = profile.getEmail();
            customerDetails.phoneMobile = profile.getPhoneMobile();
            
        }
    }

    return {
        success: true,
        message: 'Login successful',
        details: serviceResult.object,
        customer: customerDetails
    };

}
/**
 * Handles the passwordless login API.
 * This implementation simply returns success for now.
 *
 * @param {Object} context - Headless API context
 * @returns {Object} JSON response
 */
exports.passwordlessLogin = function () {
    try {
        var result = exports.passwordlessLoginHelper();

        if (result.success) {
            RESTResponseMgr.createSuccess(result).render();
        } else {
            RESTResponseMgr.createError(
                400,                     // statusCode
                'BadRequest',            // type
                result.message || 'Bad Request', // title
                result.details && result.details.error
                    ? result.details.error
                    : 'An error occurred while processing the request'
            ).render();

        }
    } catch (error) {
        Logger.error('Error in passwordlessLogin: {0}', error.message);
        RESTResponseMgr.createError(
            500,                    // HTTP Status Code
            'InternalServerError',  // Type (camelCase or descriptive type)
            'Internal Server Error',// Title
            error.message || 'Unexpected error occurred while processing passwordless login'
        ).render();

    }
};

exports.passwordlessLogin.public = true;
