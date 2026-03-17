'use strict';

var server = require('server');
var Logger = require('dw/system/Logger');
var Bytes = require('dw/util/Bytes');
var Encoding = require('dw/crypto/Encoding');
var Mac = require('dw/crypto/Mac');
var Site = require('dw/system/Site');
var CouponCampaignHelper = require('*/cartridge/scripts/helpers/CouponCampaignHelper.js');

server.post('AddCoupon', function (req, res, next) {
    try {
        // Read raw request body (webhook JSON)
        var rawBody = req.body || "{}" // available in SFCC when webhook sends JSON

        var payload;
        try {
            payload = JSON.parse(rawBody);
        } catch (e) {
            Logger.error('Refersion Webhook: Invalid JSON payload. Error: {0}', e);
            res.setStatusCode(400);
            res.json({ success: false, message: 'Invalid JSON' });
            return next();
        }

        if (payload.type != "COUPON") {
            res.json({ success: false, message: 'Not a coupon event.' });
            return next();
        }

        // Get headers
        var refersionTopic = req.httpHeaders['refersion-topic'];
        var refersionSignature = req.httpHeaders['refersion-signature'];

        var pref = Site.getCurrent().getPreferences().getCustom();
        var webhookSecret = pref.refersionWebhookSecret; 
        if (!webhookSecret) {
            Logger.error('Refersion Webhook: Missing Signing Secret in Site Preferences.');
            res.setStatusCode(500);
            res.json({ success: false, message: 'Server configuration error' });
            return next();
        }

        // // ////////////////////////// VALIDATING SIGNATURE ////////////////////////////////////
        var keyBytes = new Bytes(webhookSecret, "UTF-8"); // Secret key bytes
        var bodyBytes = new Bytes(rawBody, "UTF-8"); // Raw body bytes
        var mac = new Mac(Mac.HMAC_SHA_256); 
        var hmacResult = mac.digest(bodyBytes, keyBytes); // HMAC SHA256
        var mySignature = Encoding.toBase64(hmacResult); // Base64 encode
        var isValid = (refersionSignature === mySignature);
        if (!isValid) {
            Logger.warn('Refersion Webhook: Signature mismatch. Body: {0} | MySig: {1} | TheirSig: {2}',
                rawBody, mySignature, refersionSignature
            );
            res.setStatusCode(401);
            res.json({ success: false, message: 'Invalid signature' });
            return next();
        }
        // // //////////////////////////////////////////////////////////////////////////////////

        var CouponCampaignResult = CouponCampaignHelper.createCouponUpdateCampaign(payload);
        if (CouponCampaignResult.error) {
            res.json({
                success: false,
                message: 'Failed to process coupon and campaign update',
                details: CouponCampaignResult
            });

            return next();
        }

        // Log webhook data for testing
        Logger.info('✅ Refersion Webhook Verified Successfully');
        Logger.info('🔹 Topic: {0}', refersionTopic);
        Logger.info('🔹 Payload: {0}', JSON.stringify(payload));

        // Respond success
        res.json({
            success: true,
            message: 'Webhook received and verified successfully',
            topic: refersionTopic,
            couponCampaignResult: CouponCampaignResult
        });
    } catch (err) {
        Logger.error('Refersion Webhook: Exception occurred. Error: {0}', err);
        res.setStatusCode(500);
        res.json({ success: false, message: 'Internal server error' + err });
    }

    return next();
});


module.exports = server.exports();