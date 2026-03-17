'use strict';


var Signature = require('dw/crypto/Signature');
var Encoding = require('dw/crypto/Encoding');
var Logger = require('dw/system/Logger');
var keyRef = require('dw/crypto/KeyRef')
var Bytes = require('dw/util/Bytes');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
/**
 * Helper function to generate signature using SFCC native crypto
 * @param {Object} payload - The object to sign
 * @param {string} keyAlias - The Alias of the key stored in Business Manager
 */
function createSignature(payload, keyAlias,isWalletTransaction) {
    // 1. Define required fields (Matched to your breezeCartObject)
    var requiredFields = ["id", "initialPrice","totalPrice","totalDiscount","itemCount","currency", "items"];
    if (isWalletTransaction !== true) {
        requiredFields.push("attributes");
    }
    var objKeys = Object.keys(payload);

    var hasAllKeys = requiredFields.every(function (key) {
        return objKeys.indexOf(key) !== -1;
    });

    if (hasAllKeys) {
        var signaturePayload = JSON.stringify(payload);
        
        try {
            var signer = new Signature();
            var myKeyRef = new keyRef(keyAlias)
            

            var payloadBytes = new Bytes(signaturePayload);
            var signatureBytes = signer.signBytes(payloadBytes, myKeyRef, "SHA256withRSA");
            var signatureString = Encoding.toBase64(signatureBytes);
            return {
                signature: signatureString,
                signaturePayload: signaturePayload
            };
        } catch (e) {
            var x = e;
            Logger.error('Signing failed: ' + e.message);
            throw new Error("Crypto Signing Failed. Check Keystore Alias.");
        }
    } else {
        throw new Error("Not a valid JSON payload: Missing required fields");
    }
}


module.exports = {
    createSignature:createSignature
}

