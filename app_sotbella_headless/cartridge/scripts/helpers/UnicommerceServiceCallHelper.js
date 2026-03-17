'use strict';

var authSvc = require('*/cartridge/services/UnicommerceAuthServices')
var tokenHelper = require('*/cartridge/scripts/helpers/UnicommerceTokenHelper');

function callCreateSaleOrder(order, apiFunction) {

    var token = tokenHelper.getStoredAccessToken();

    // 1st attempt using existing token
    var response = apiFunction(order, token);

    if (response.error !== 401) {
        return response;
    }

    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();

    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);

        // retry API with new token
        return apiFunction(order, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}



function callGetInventoryUpdates(lastNMinutes, skuIds, apiFunction) {
    var token = tokenHelper.getStoredAccessToken();

    // 1st attempt using existing token
    var response = apiFunction(lastNMinutes, skuIds, token);
    if (response.error !== 401) {
        return response;
    }
    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        // retry API with new token
        return apiFunction(lastNMinutes, skuIds, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

function callGetSaleOrder(orderNo, apiFunction) {
    var token = tokenHelper.getStoredAccessToken();

    // 1st attempt using existing token
    var response = apiFunction(orderNo, token);
    if (response.error !== 401) {
        return response;
    }
    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        // retry API with new token
        return apiFunction(orderNo, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

function callSearchSaleOrders(channel, minutes, apiFunction) {
    var token = tokenHelper.getStoredAccessToken();
    // 1st attempt using existing token
    var response = apiFunction(channel, minutes, token);
    if (response.error !== 401) {
        return response;
    }
    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        // retry API with new token
        return apiFunction(channel, minutes, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

function callCancelSaleOrder(orderNo,sku, cancelWholeOrder, apiFunction) {
    var token = tokenHelper.getStoredAccessToken();
    // 1st attempt using existing token
    var response = apiFunction(orderNo,sku, cancelWholeOrder, token);
    if (response.error !== 401) {
        return response;
    }
    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        // retry API with new token
        return apiFunction(orderNo,sku, cancelWholeOrder, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

function callCreateReversePickup(order, sku, reason, customerImageUrl, apiFunction) {
    var returnContext = {
        sku, reason, customerImageUrl
    }
    var token = tokenHelper.getStoredAccessToken();

    // 1st attempt using existing token
    var response = apiFunction(order, returnContext, token);
    if (response.error !== 401) {
        return response;
    }

    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        return apiFunction(order, returnContext, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

function callAllocateCourierForReversePickup(reversePickupCode, apiFunction) {
    var token = tokenHelper.getStoredAccessToken();
    // 1st attempt using existing token
    var response = apiFunction(reversePickupCode, token);
    if (response.error !== 401) {
        return response;
    }
    // 2nd attempt after getting a new access token
    var tokenResponse = authSvc.getAccessToken();
    if (tokenResponse.ok && tokenResponse.object.access_token) {
        tokenHelper.saveAccessToken(tokenResponse.object.access_token);
        // retry API with new token
        return apiFunction(reversePickupCode, tokenResponse.object.access_token);
    }
    return { error: true, message: 'Unable to generate access token' };
}

module.exports = {
    callCreateSaleOrder: callCreateSaleOrder,
    callGetInventoryUpdates: callGetInventoryUpdates,
    callGetSaleOrder: callGetSaleOrder,
    callSearchSaleOrders: callSearchSaleOrders,
    callCancelSaleOrder: callCancelSaleOrder,
    callCreateReversePickup: callCreateReversePickup,
    callAllocateCourierForReversePickup: callAllocateCourierForReversePickup
};