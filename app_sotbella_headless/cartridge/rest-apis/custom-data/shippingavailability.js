/* eslint-disable require-jsdoc */

'use strict';
 
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');

// Import your services
var shiprocketAuthService = require('*/cartridge/services/shiprocketService.js');
var shiprocketCheckService = require('*/cartridge/services/shiprocketService.js');
var shipmozoRateService = require('*/cartridge/services/shipmozoService.js');

var logger = Logger.getLogger('CustomAPI', 'HeadlessUtility');


exports.shippingAvailabilityHelper = function () {
    try {
        var requestBody = request.httpParameterMap.requestBodyAsString;

        if (!requestBody) {
            return {
                isServicable: false,
                isCOD: false,
                details: { error: 'Empty request body' }
            };
        }

        var requestJSON;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            return {
                isServicable: false,
                isCOD: false,
                details: { error: 'Invalid JSON format in request body' }
            };
        }

        var pincode = requestJSON.pincode;
        var cod = (requestJSON.cod !== undefined) ? requestJSON.cod : true;
        var weight = 0.5; // 0.5 kg
        var orderAmount = 2000; // Standard order value (INR)
        var dimensions = [{
            "no_of_box": 1,
            "length": 10,
            "width": 10,
            "height": 5
        }];
        // ---------------------------------------------
        // Step 1: Shiprocket Auth
        // ---------------------------------------------
        var authResult = shiprocketAuthService.getAccessToken.call();
        if (!authResult.ok || !authResult.object || !authResult.object.token) {
            logger.error('Shiprocket auth failed.');
            return { isServicable: false, isCOD: false, detail: JSON.parse(authResult.errorMessage) };
        }
        var token = authResult.object.token;

        // ---------------------------------------------
        // Step 2: Shiprocket Serviceability
        // ---------------------------------------------
        var serviceabilityResult = shiprocketCheckService.checkServiceability.call({
            delivery_postcode: pincode,
            weight: weight,
            cod: cod ? 1:0,
            token: token
        });

        if (serviceabilityResult.ok &&
            serviceabilityResult.object &&
            serviceabilityResult.object.data &&
            serviceabilityResult.object.data.available_courier_companies &&
            serviceabilityResult.object.data.available_courier_companies.length > 0) {

            return { isServicable: true, isCOD: true };
        }


        // ---------------------------------------------
        // Step 3: Fallback to Shipmozo Rate Calculator
        // ---------------------------------------------
        var rateResult = shipmozoRateService.rateCalculator.call({
            delivery_pincode: pincode,
            cod: cod,
            order_amount: orderAmount,
            weight: weight,
            dimensions: dimensions,
            cod_amount: cod ? orderAmount : "",
            payment_type: cod ? 'COD' : 'PREPAID',
            shipment_type: 'FORWARD',
            type_of_package: 'SPS',
            rov_type: 'ROV_OWNER'
        });

        
        if (rateResult.ok &&
            rateResult.object &&
            rateResult.object.data &&
            rateResult.object.data.length > 0) {

            return { isServicable: true, isCOD: true };
        }

        // No service found
        return { isServicable: false, isCOD: false };

    } catch (error) {
        logger.error('Unexpected error in shippingAvailabilityHelper: {0}', error.message);
        return { isServicable: false, isCOD: false, details: { error: error.message } };
    }
};

/**
 * Public SCAPI endpoint
 */
exports.shippingAvailability = function () {
    try {
        var result = exports.shippingAvailabilityHelper();
        RESTResponseMgr.createSuccess(result).render();
    } catch (error) {
        logger.error('Error in shippingAvailability: {0}', error.message);
        RESTResponseMgr.createError(
            500,                    // HTTP Status Code
            'InternalServerError',  // Type
            'Internal Server Error',// Title
            error.message || 'Unexpected error occurred while processing shipping availability'
        ).render();
    }
};
exports.shippingAvailability.public = true;
