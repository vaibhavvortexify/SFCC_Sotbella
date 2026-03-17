'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var UUIDUtils = require('dw/util/UUIDUtils');
var Site = require('dw/system/Site');
var BreezeHelper = require('*/cartridge/scripts/helpers/BreezeHelper');

exports.walletTopup = function () {
    try {
        
        var requestBody = request.httpParameterMap.requestBodyAsString;
        if (!requestBody) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Request body is required', {}).render();
        }

        var requestJSON;
        try {
            requestJSON = JSON.parse(requestBody);
        } catch (parseError) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Invalid JSON format', {}).render();
        }

        var amount = requestJSON.amount;
        var currency = requestJSON.currency || Site.getCurrent().getDefaultCurrency();
        var deviceId  = requestJSON.deviceId || null;
        
        if (!amount || amount <= 0) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'Valid amount is required', {}).render();
        }
        if(!deviceId){
            return RESTResponseMgr.createError(400, 'BadRequest', 'Device ID is required', {}).render();
        }
        // --- NEW LOGIC: Check Wallet Topup Threshold ---
        var threshold = Site.getCurrent().getCustomPreferenceValue('walletTopupThreshold');
        if (threshold && amount > threshold) {
            return RESTResponseMgr.createError(400, 'BadRequest', 'You can only add up to ' + threshold + ' amount to your wallet.', JSON.stringify({maxLimit: threshold})).render();
        }
        if (!customer.isAuthenticated()) {
             return RESTResponseMgr.createError(401, 'Unauthorized', 'You must be logged in to recharge wallet', {}).render();
        }

        var transactionId = UUIDUtils.createUUID();
        var customerNo = customer.getProfile().getCustomerNo();
        
        var amountInteger = Math.round(amount * 100);

        // 4. Create Breeze Payload (Single Item for Recharge)
        var breezeItems = [{
            id: "WALLET_TOPUP",
            title: "Wallet Recharge",
            quantity: 1,
            discount: 0,
            initialPrice: amountInteger, 
            finalPrice: amountInteger    
        }];

        var breezeCartObject = {
            id: transactionId, // Transaction ID acts as Cart ID
            initialPrice: amountInteger,
            totalPrice: amountInteger,
            totalDiscount: 0,
            itemCount: 1,
            currency: currency,
            items: breezeItems
        };

        // 5. Generate Signature using Helper
        var result = BreezeHelper.createSignature(breezeCartObject, 'breeze_cart_private_key',true);

        // 6. Create Custom Object Record (The Database Entry)
        Transaction.wrap(function () {
            // Ensure 'WalletTransaction' exists in Business Manager > Custom Object Types
            var co = CustomObjectMgr.createCustomObject('walletTransactions', transactionId);
            
            co.custom.customerNo = customerNo;
            co.custom.amount = amount; // Store actual decimal amount
            co.custom.status = 'pending';
            co.custom.payload = result.signaturePayload; // Save for debugging
        });

        Logger.info('Wallet Topup Initiated. Txn: {0}, Cust: {1}, Amt: {2}', transactionId, customerNo, amount);

        // 7. Return Response
        return RESTResponseMgr.createSuccess({
            success: true,
            message: 'Topup initiated',
            transactionId: transactionId,
            signature: result.signature,
            payload: result.signaturePayload
        }).render();

    } catch (e) {
        Logger.error('Error in initiateTopup: {0}', e.message);
        
        return RESTResponseMgr.createError(500, 'InternalServerError', e.message, {}).render();
    }
};

exports.walletTopup.public = true;