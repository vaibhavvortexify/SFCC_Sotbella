'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

var checkPincodeServiceability = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/pincode-serviceability');
            var pickup_pincode = Site.getCurrent().getCustomPreferenceValue('shipmozo_pickupcode')
            // Fetch API keys from site preferences
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');
            
            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');
            
            var payload = {
                pickup_pincode: pickup_pincode,
                delivery_pincode: params.delivery_pincode
            };

            Logger.info('ShipmozoPincodeServiceability - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoPincodeServiceability - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoPincodeServiceability - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoPincodeServiceability - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoPincodeServiceability - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoPincodeServiceability - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Pincode Serviceability API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask private key if logged
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success (Mock)",
            data: {
                serviceable: true
            }
        };
    }
});

var rateCalculator = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/rate-calculator');
            var pickup_pincode = Site.getCurrent().getCustomPreferenceValue('shipmozo_pickupcode')
            // Auth headers
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            var payload = {
                pickup_pincode: pickup_pincode,
                delivery_pincode: params.delivery_pincode,
                payment_type: params.payment_type,           // PREPAID or COD
                shipment_type: params.shipment_type,         // FORWARD, RETURN, etc.
                order_amount: params.order_amount,
                type_of_package: params.type_of_package,     // SPS, etc.
                rov_type: params.rov_type,                   // ROV_OWNER, etc.
                weight: params.weight,                       // grams
                dimensions: params.dimensions                // [length, width, height]
            };

            if (params.order_id) {
                payload.order_id = params.order_id;
            }
            if (params.cod_amount) {
                payload.cod_amount = params.cod_amount;
            }

            Logger.info('ShipmozoRateCalculator - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoRateCalculator - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoRateCalculator - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoRateCalculator - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoRateCalculator - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoRateCalculator - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Rate Calculator API' };
        }
    },

    filterLogMessage: function (msg) {
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success",
            data: [
                {
                    id: 206,
                    name: "Bluedart 0.5KG",
                    estimated_delivery: "1 Days",
                    shipping_charges: 38,
                    total_charges: 44.84,
                    gst_percentage: 18
                },
                {
                    id: 29,
                    name: "XpressBees 0.5 Kg",
                    estimated_delivery: "1 Days",
                    shipping_charges: 33,
                    total_charges: 38.94,
                    gst_percentage: 18
                }
            ]
        };
    }
});


var pushOrder = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/push-order');
            
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            var payload = params.payload;

            Logger.info('ShipmozoPushOrder - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoPushOrder - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoPushOrder - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoPushOrder - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoPushOrder - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoPushOrder - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Push Order API' };
        }
    },

    filterLogMessage: function (msg) {
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success",
            data: {
                Info: "Order Pushed Successfully (Mock )",
                order_id: "MockAP859611378561",
                refrence_id: "ordID",
                error: ""
            }
        };
    }
});


var autoAssignCourier = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/auto-assign-order');

            // Authentication headers from site prefs
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            var payload = {
                order_id: params.order_id
            };

            Logger.info('ShipmozoAutoAssignCourier - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoAutoAssignCourier - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoAutoAssignCourier - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoAutoAssignCourier - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoAutoAssignCourier - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoAutoAssignCourier - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Auto Assign Courier API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask private key if logged
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success (Mock)",
            data: {
                order_id: "test123",
                reference_id: "test123",
                awb_number: "123123123",
                courier_company: "Delhivery",
                courier_company_service: "Delhivery"
            }
        };
    }
});


var assignCourierManually = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/assign-courier');

            // Auth headers from site preferences
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            var payload = {
                order_id: params.order_id,
                courier_id: params.courier_id
            };

            Logger.info('ShipmozoAssignCourier - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoAssignCourier - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoAssignCourier - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoAssignCourier - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoAssignCourier - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoAssignCourier - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Assign Courier API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask private key
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success",
            data: {
                order_id: "test123",
                reference_id: "test123",
                courier: "Delhivery"
            }
        };
    }
});

var cancelOrder = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/cancel-order');

            // Auth headers from site preferences
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            var payload = {
                order_id: params.order_id,
                awb_number: params.awb_number
            };

            Logger.info('ShipmozoCancelOrder - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShipmozoCancelOrder - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoCancelOrder - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoCancelOrder - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoCancelOrder - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoCancelOrder - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Cancel Order API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask private key
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success",
            data: {
                order_id: "test123",
                reference_id: "test123"
            }
        };
    }
});
var trackOrder = LocalServiceRegistry.createService('shipmozo.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('GET');
            var url = svc.configuration.credential.URL + '/track-order?awb_number=' + encodeURIComponent(params.awb_number);
            svc.setURL(url);

            // Auth headers from site preferences
            var publicKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_public_key');
            var privateKey = Site.getCurrent().getCustomPreferenceValue('shipmozo_private_key');

            svc.addHeader('public-key', publicKey);
            svc.addHeader('private-key', privateKey);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Accept', 'application/json');

            Logger.info('ShipmozoTrackOrder - Tracking URL: {0}', url);
            return null; // GET has no body
        } catch (error) {
            Logger.error('ShipmozoTrackOrder - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShipmozoTrackOrder - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShipmozoTrackOrder - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShipmozoTrackOrder - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShipmozoTrackOrder - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shipmozo Track Order API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask private key
        return msg.replace(/"private-key"\s*:\s*".*?"/, '"private-key":"***"');
    },

    mockCall: function () {
        return {
            result: "1",
            message: "Success",
            data: {
                order_id: "12634WP61391513073",
                reference_id: "12634WP61391513073",
                awb_number: "GGN9000181640",
                courier: "Professional 0.5KG",
                expected_delivery_date: null,
                current_status: "Pickup Pending",
                status_time: null,
                scan_detail: []
            }
        };
    }
});


module.exports = {
    checkPincodeServiceability: checkPincodeServiceability,
    rateCalculator:rateCalculator,
    assignCourierManually:assignCourierManually,
    autoAssignCourier:autoAssignCourier,
    pushOrder:pushOrder,
    trackOrder:trackOrder,
    cancelOrder:cancelOrder
};
