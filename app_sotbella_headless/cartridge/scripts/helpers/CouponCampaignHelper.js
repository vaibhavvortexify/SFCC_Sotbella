
var oauthService = require('*/cartridge/services/AdminAuthService');
var couponService = require('*/cartridge/services/CouponService');
var campaignServices = require('*/cartridge/services/CampaignServices');
var refersionGraphQLService = require('*/cartridge/services/RefersionGraphQLService');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

function createCouponUpdateCampaign(payload) {
    // var campaignId = 'campaignCheck';

    var log = Logger.getLogger('CampaignCouponHelper', 'Campaign-Coupon');

    try {

        /* --------------------------------------------------
         * 1. GET TOKEN
         * -------------------------------------------------- */
        
        var pref = Site.getCurrent().getPreferences().getCustom();
        var tokenResult = oauthService.call({
            scope: pref.AdminScopes
        });

        if (!tokenResult.ok || !tokenResult.object.access_token) {
            log.error('Failed to retrieve OAuth token: {0}', tokenResult.errorMessage);
            return { error: true, step: 'token', message: 'Failed to get OAuth token' };
        }

        var accessToken = tokenResult.object.access_token;
        var couponId = payload.trigger;
        var affiliate_id = payload.affiliate_id;



        /* --------------------------------------------------
         * 2. GET AFFILIATE DATA - USING GRAPHQL API
         * -------------------------------------------------- */
        var query = "{ affiliates (id: " + affiliate_id + ") {id, first_name, country, custom_fields } }";
        var graphQLResult = refersionGraphQLService.call({ query: query });

        if (!graphQLResult.ok || graphQLResult.object.error) {
            log.error(
                'Failed to fetch affiliate data for affiliate_id {0}: {1}',
                affiliate_id,
                graphQLResult.errorMessage || JSON.stringify(graphQLResult.object)
            );
            return {
                error: true,
                step: 'affiliate-data',
                message: 'Failed to fetch affiliate data',
                details: graphQLResult.object
            };
        }

        var campaignId = null;
        campaignId = getCampaignId(graphQLResult.object.data.affiliates[0]);
        var siteId = '';
        siteId = getSiteId(graphQLResult.object.data.affiliates[0]);

        if (siteId) {

            /* --------------------------------------------------
             * 3. CREATE COUPON FIRST
             * -------------------------------------------------- */
            var couponCreateResult = couponService.call({
                siteId: siteId,
                couponId: couponId,
                description: 'triggerId: ' + payload.id + ' - affiliate_id: ' + payload.affiliate_id,
                accessToken: accessToken
            });

            if (!couponCreateResult.ok) {
                log.error('Failed to create coupon {0}: {1}', couponId, couponCreateResult.errorMessage);
                return {
                    error: true,
                    step: 'coupon-create',
                    message: 'Failed to create coupon',
                    details: couponCreateResult.object || couponCreateResult.errorMessage
                };
            }

            if (campaignId) {
                /* --------------------------------------------------
                * 4. GET CAMPAIGN
                * -------------------------------------------------- */
                var campaignGetResult = campaignServices.campaignGetService.call({
                    campaignId: campaignId,
                    siteId: siteId,
                    accessToken: accessToken
                });

                if (!campaignGetResult.ok) {
                    log.error('Failed to get campaign {0}: {1}', campaignId, campaignGetResult.errorMessage);
                    return {
                        error: true,
                        step: 'campaign-get',
                        message: 'Failed to fetch campaign',
                        details: campaignGetResult.object
                    };
                }

                var campaign = campaignGetResult.object;
                var existingCoupons = campaign.coupons || [];

                /* --------------------------------------------------
                 * 5. ADD COUPON (NO DUPLICATE)
                 * -------------------------------------------------- */
                if (existingCoupons.indexOf(couponId) === -1) {
                    existingCoupons.push(couponId);
                }

                /* --------------------------------------------------
                 * 6. UPDATE CAMPAIGN
                 * -------------------------------------------------- */
                var campaignUpdateResult = campaignServices.campaignUpdateService.call({
                    campaignId: campaignId,
                    siteId: siteId,
                    accessToken: accessToken,
                    coupons: existingCoupons
                });

                if (!campaignUpdateResult.ok) {
                    log.error(
                        'Failed to update campaign {0} with coupon {1}: {2}',
                        campaignId,
                        couponId,
                        campaignUpdateResult.errorMessage
                    );

                    return {
                        error: true,
                        step: 'campaign-update',
                        message: 'Failed to update campaign',
                        details: campaignUpdateResult.object
                    };
                }

                /* --------------------------------------------------
                 * SUCCESS RESPONSE
                 * -------------------------------------------------- */
                return {
                    success: true,
                    step: 'completed',
                    message: 'Coupon created and campaign updated successfully',
                    couponCreated: couponCreateResult.object,
                    updatedCoupons: existingCoupons
                };

            }

            /* --------------------------------------------------
                 * SUCCESS RESPONSE
                 * -------------------------------------------------- */
            return {
                success: true,
                step: 'completed',
                message: 'Coupon created successfully but campaign not updated.',
                couponCreated: couponCreateResult.object,
                updatedCoupons: 'N/A - No campaignId found - campaign not updated - check RefersionCampaignMap'
            };
        }

        return {
            success: false,
            error: true,
            message: 'no siteId found for affiliate - coupon not created - campaign not updated'
        }

    } catch (e) {
        log.error('Unexpected error in createCouponUpdateCampaign: {0}', e.message);
        return {
            error: true,
            step: 'exception',
            message: 'Unexpected system error',
            details: e.message
        };
    }
}

// Will return the campaign Id that the coupon will be mapped with.
function getCampaignId(affiliate) {
    var customFields = affiliate.custom_fields || [];
    var followerCount = 0;

    customFields.forEach(function (field) {
        if (field[1] === 'Followers') {
            followerCount = +field[2];
        }
    });
    var RefCampaignMap = {};

    var pref = Site.getCurrent().getPreferences().getCustom();
    try {
        RefCampaignMap = JSON.parse(pref.RefersionCampaignMap);
    } catch (e) {
        Logger.getLogger('CampaignCouponHelper', 'Campaign-Coupon').error('Error parsing RefersionCampaignMap preference: {0}', e.message);
        return null;
    }

    var followers = RefCampaignMap.followers || [];
    var campaignIds = RefCampaignMap.campaignIds || [];

    if (followers.length + 1 !== campaignIds.length) {
        Logger.getLogger('CampaignCouponHelper', 'Campaign-Coupon').error('Mismatch in followers and campaignIds required lengths in RefersionCampaignMap preference.');
        return null;
    }

    var i = 0;
    for (; i < followers.length; i++) {
        if (followerCount <= followers[i]) {
            return campaignIds[i];
        }
    }

    return campaignIds[i];
}

function getSiteId(affiliate) {
    var customFields = affiliate.custom_fields || [];
    var websiteUrl = '';

    customFields.forEach(function (field) {
        if (field[1] === 'Website URL') {
            websiteUrl = field[2];
        }
    });

    if (websiteUrl === '') {
        return null;
    }

    var siteMapPref = {};

    var pref = Site.getCurrent().getPreferences().getCustom();
    try {
        siteMapPref = JSON.parse(pref.RefersionSiteMap);
    } catch (e) {
        Logger.getLogger('CampaignCouponHelper', 'Campaign-Coupon').error('Error parsing RefersionSiteMap preference: {0}', e.message);
        return null;
    }

    var domains = siteMapPref.domains || [];
    var siteMap = siteMapPref.mapping || {};
    for (var i = 0; i < domains.length; i++) {
        if (websiteUrl.indexOf(domains[i]) !== -1) {
            return siteMap[domains[i]];
        }
    }
    return null;
}

module.exports = {
    createCouponUpdateCampaign: createCouponUpdateCampaign
};