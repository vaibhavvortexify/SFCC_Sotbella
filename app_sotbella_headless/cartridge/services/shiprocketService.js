var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');
var getAccessToken = LocalServiceRegistry.createService('shiprocket.shipping',{
    createRequest: function (svc, params) {
        svc.setRequestMethod('POST');
        svc.setURL(svc.configuration.credential.URL + '/auth/login');
        svc.addHeader('Content-Type', 'application/json');
        Logger.info('ShiprocketAuthService - Sending request to {0}', svc.getURL());
        var username = Site.getCurrent().getCustomPreferenceValue('shiprocket_username');
        var password = Site.getCurrent().getCustomPreferenceValue('shiprocket_password');
        
        return JSON.stringify({
            email: username,
            password: password
        });
    },
     parseResponse: function (svc, client) {
        try {
            var result  = JSON.parse(client.text);
            if (client.statusCode !== 200) {
                Logger.error('ShiprocketAuthService - error with status code: {0}, Response: {1}',client.statusCode, client.text);
            }
            return result
        } catch (e) {
            Logger.error('ShiprocketAuthService - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON response from while fetching Shiprocket accesstoken' };
        }
     },
     filterLogMessage: function (msg) {
        // Prevent sensitive data (like password) from being logged
        return msg.replace(/"password"\s*:\s*".*?"/, '"password":"***"');
    },
    mockCall: function () {
        return {
            token: "mocked-token-12345",
            status_code: 200,
            company_id:134211,
            created_at: "2025-09-01 15:24:11",
        };
    }

})
var checkServiceability = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            var pickup_postcode = Site.getCurrent().getCustomPreferenceValue('shiprocket_pickup_postcode');
            svc.setRequestMethod('GET');
            var url = svc.configuration.credential.URL + '/courier/serviceability/' +
                '?pickup_postcode=' + encodeURIComponent(pickup_postcode) +
                '&delivery_postcode=' + encodeURIComponent(params.delivery_postcode) +
                '&weight=' + encodeURIComponent(params.weight) +
                '&cod=' + encodeURIComponent(params.cod);
                if (params.mode) {
                    url += '&mode=' + encodeURIComponent(params.mode);
                }

            svc.setURL(url);
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            Logger.info('ShiprocketCheckServiceAbility - Full URL: {0}', url);
            return null;
        } catch (error) {
            Logger.error('ShiprocketCheckServiceAbility - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketCheckServiceAbility - Response status: {0}', client.statusCode);
            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketCheckServiceAbility - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket courier API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask token if logged
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            status_code: 200,
            available_courier_companies: [
                { courier_name: "MockCourier", rate: 100, etd: "2025-09-20" }
            ]
        };
    }
});

var createOrder = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            var pickup_location = Site.getCurrent().getCustomPreferenceValue('shiprocket_pickup_location')
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/orders/create/adhoc');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);
            
            var payload = params.payload;

            Logger.info('ShiprocketCreateOrder - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);
        } catch (error) {
            Logger.error('ShiprocketCreateOrder - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketCreateOrder - Response status: {0}', client.statusCode);
                        // log full response text (truncate if too big)
            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketCreateOrder - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketCreateOrder - Full Response: {0}', responseText);
            }
            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketCreateOrder - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Create Order API' };
        }
    },

    filterLogMessage: function (msg) {
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            status_code: 200,
            order_id: "MOCK123456",
            Staus: "New",
            status_code: 1,
            shipment_id: 966566379,
        };
    }
});

var cancelOrder = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/orders/cancel');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            var payload = {
                ids: params.ids // array of order IDs
            };

            Logger.info('ShiprocketCancelOrder - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShiprocketCancelOrder - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketCancelOrder - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketCancelOrder - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketCancelOrder - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketCancelOrder - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Cancel Order API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask Bearer token in logs
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            status_code: 200,
            message: "Order cancelled successfully (mock)"
        };
    }

});
var assignAWBToShipment = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/courier/assign/awb');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            var payload = {
                shipment_id: params.shipment_id
            };

            if (params.courier_id) {
                payload.courier_id = params.courier_id; // optional
            }

            Logger.info('ShiprocketAssignAWB - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShiprocketAssignAWB - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketAssignAWB - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketAssignAWB - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketAssignAWB - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketAssignAWB - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Assign AWB API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask Bearer token
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            awb_assign_status: 1,
            response: {
                data: {
                    awb_code: "MOCKAWB12345",
                    courier_name: "MockCourier",
                    shipment_id: 999999
                }
            }
        };
    }
});

var trackShipment = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('GET');
            var url = svc.configuration.credential.URL + '/courier/track/shipment/' + encodeURIComponent(params.shipment_id);
            svc.setURL(url);

            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            Logger.info('ShiprocketTrackShipment - Tracking URL: {0}', url);
            return null; // GET has no body
        } catch (error) {
            Logger.error('ShiprocketTrackShipment - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketTrackShipment - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketTrackShipment - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketTrackShipment - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketTrackShipment - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Track Shipment API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask Bearer token
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return [
            {
                tracking_data: {
                    track_status: 1,
                    shipment_status: 42,
                    shipment_track: [
                        {
                            awb_code: "MOCKAWB12345",
                            current_status: "PICKED UP",
                            origin: "Delhi",
                            destination: "Mumbai"
                        }
                    ],
                    shipment_track_activities: [
                        { date: "2025-09-18 12:00:00", activity: "Picked up from origin", location: "Delhi" }
                    ],
                    track_url: "https://mock.shiprocket/tracking/MOCKAWB12345"
                }
            }
        ];
    }
});
var generatePickup = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/courier/generate/pickup');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            var payload = {
                shipment_id: params.shipment_id // must be an array e.g. [16090109]
            };

            if (params.pickup_date) {
                payload.pickup_date = params.pickup_date; // e.g. ["2022-06-04"]
            }

            Logger.info('ShiprocketGeneratePickup - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShiprocketGeneratePickup - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketGeneratePickup - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketGeneratePickup - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketGeneratePickup - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketGeneratePickup - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Generate Pickup API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask Bearer token in logs
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            pickup_status: 1,
            response: {
                pickup_scheduled_date: "2025-09-20 14:00:00",
                pickup_token_number: "MOCKPICKUPTOKEN123",
                status: 3,
                data: "Pickup confirmed for shipment MOCK"
            }
        };
    }
});

var generateManifest = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/manifests/generate');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);

            var payload = {
                shipment_id: params.shipment_id // must be an array e.g. [16090109]
            };

            Logger.info('ShiprocketGenerateManifest - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);

        } catch (error) {
            Logger.error('ShiprocketGenerateManifest - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketGenerateManifest - Response status: {0}', client.statusCode);

            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketGenerateManifest - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketGenerateManifest - Full Response: {0}', responseText);
            }

            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketGenerateManifest - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket Generate Manifest API' };
        }
    },

    filterLogMessage: function (msg) {
        // Mask Bearer token
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            status: 200,
            manifest_url: "https://mock.shiprocket/manifest/MOCKMANIFEST.pdf",
            message: "Manifest generated successfully (mock)"
        };
    }
});

var createForwardShipment = LocalServiceRegistry.createService('shiprocket.shipping', {
    createRequest: function (svc, params) {
        try {
            svc.setRequestMethod('POST');
            svc.setURL(svc.configuration.credential.URL + '/shipments/create/forward-shipment');
            svc.addHeader('Content-Type', 'application/json');
            svc.addHeader('Authorization', 'Bearer ' + params.token);
            
            var payload = params.payload;

            Logger.info('ShiprocketCreateForwardShipment - Payload: {0}', JSON.stringify(payload));
            return JSON.stringify(payload);
        } catch (error) {
            Logger.error('ShiprocketCreateForwardShipment - Error building request: {0}', error.message);
            throw error;
        }
    },

    parseResponse: function (svc, client) {
        try {
            Logger.info('ShiprocketCreateForwardShipment - Response status: {0}', client.statusCode);
                        // log full response text (truncate if too big)
            var responseText = client.text;
            if (responseText && responseText.length > 2000) {
                Logger.info('ShiprocketCreateForwardShipment - Response (truncated): {0}', responseText.substring(0, 2000) + '...');
            } else {
                Logger.info('ShiprocketCreateForwardShipment - Full Response: {0}', responseText);
            }
            return JSON.parse(client.text);
        } catch (e) {
            Logger.error('ShiprocketCreateForwardShipment - Failed to parse response: {0}', e.message);
            return { error: true, message: 'Invalid JSON from Shiprocket CreateForwardShipment Order API' };
        }
    },

    filterLogMessage: function (msg) {
        return msg.replace(/Bearer\s+[A-Za-z0-9\.\-\_]+/, 'Bearer ***');
    },
    mockCall: function () {
        return {
            status_code: 200,
            order_id: "MOCK123456",
            Staus: "New",
            status_code: 1,
            shipment_id: 966566379,
        };
    }
});

module.exports = {
    getAccessToken:getAccessToken,
    checkServiceability:checkServiceability,
    createOrder:createOrder,
    cancelOrder: cancelOrder,
    assignAWBToShipment:assignAWBToShipment,
    trackShipment:trackShipment,
    generatePickup:generatePickup,
    generateManifest:generateManifest,
    createForwardShipment:createForwardShipment   
}