'use strict';

var collections = require('*/cartridge/scripts/util/collections');
var ShippingLocation = require('dw/order/ShippingLocation');
var TaxMgr = require('dw/order/TaxMgr');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

/**
 * @typedef {Object} TaxField
 * @property {string} UUID - ID of the line item
 * @property {number|dw.value.Money} value - Either Tax Code or Tax Amount that should be applied to the line item.
 * @property {boolean} [amount=false] - Boolean indicating whether value field contains Tax Amount (true) or Tax Rate (false).
 */

/**
 * @typedef {Object} Response
 * @property {Array<TaxField>} taxes - List of taxes to line items UUIDs to be applied to the order
 * @property {Object} custom - List of custom properties to be attached to the basket
*/

/**
 * Calculate taxes dynamically:
 * - For site 'sotbella_in': apply custom GST slab logic.
 * - For all other sites: apply base logic using jurisdiction.
 *
 * @param {dw.order.Basket} basket - current basket
 * @returns {Response} - An object containing calculated taxes and custom properties
 */
function calculateTaxes(basket) {
    var currentSiteID = Site.getCurrent().getID();
    var taxes = [];

    if (currentSiteID === 'sotbella_in') {
        // --- Custom GST logic for sotbella_in ---
        var pref = Site.getCurrent().getPreferences().getCustom();
        var gstThreshold = {};

        try {
            gstThreshold = JSON.parse(pref.gstThreshold);
        } catch (e) {
            Logger.error('Error parsing GST threshold JSON: {0}', e.message);
        }

        var thresholdValue = gstThreshold && gstThreshold.thresholdValue ? gstThreshold.thresholdValue : 2500;
        var maxSlab = gstThreshold && gstThreshold.maxSlab ? gstThreshold.maxSlab : 'GST 18%';
        var minSlab = gstThreshold && gstThreshold.minSlab ? gstThreshold.minSlab : 'GST 5%';

        collections.forEach(basket.getShipments(), function (shipment) {
            var lineItems = shipment.getAllLineItems(); 
            collections.forEach(lineItems, function (lineItem) {
                if (!lineItem.taxClassID) {
                    return;
                }

                var taxClassId = lineItem.taxClassID;
                var jurisdictionId = null;

                try {
                    if (taxClassId === 'Standard') {
                        var price;
                        if (lineItem instanceof dw.order.ProductLineItem) {
                            if (lineItem.proratedPrice) {
                                price = lineItem.proratedPrice.value / lineItem.quantityValue;
                            } else {
                                price = lineItem.adjustedPrice.value / lineItem.quantityValue;
                            }
                        } else if (lineItem instanceof dw.order.ShippingLineItem) {
                            price = lineItem.adjustedPrice.value
                        } else {
                            price = lineItem.price.value;
                        }
                        jurisdictionId = price > thresholdValue ? maxSlab : minSlab;
                    } else {
                        taxes.push({ uuid: lineItem.UUID, value: 0.0, amount: false });
                        return;
                    }
                    if (jurisdictionId) {
                        var rate = TaxMgr.getTaxRate(taxClassId, jurisdictionId);
                        Logger.debug(
                            'SOTBELLA_IN | LineItem {0} → TaxClass {1}, Jurisdiction {2}, Rate {3}',
                            lineItem.lineItemText, taxClassId, jurisdictionId, rate
                        );
                        taxes.push({ uuid: lineItem.UUID, value: rate, amount: false });
                        // For Price Adjustments
                        if (lineItem instanceof dw.order.ProductLineItem) {
                            var allPriceAdjustments = lineItem.getPriceAdjustments();
                            if (allPriceAdjustments && allPriceAdjustments.length != 0) {
                                collections.forEach(allPriceAdjustments, function (pa) {
                                    taxes.push({ uuid: pa.UUID, value: rate, amount: false });
                                });
                            }
                        }
                    }
                } catch (e) {
                    Logger.error('Error calculating tax for LineItem {0}: {1}', lineItem.lineItemText, e.message);
                }
            });
        });

    } else {
        // --- Default logic for other sites ---
        var shipments = basket.getShipments();

        collections.forEach(shipments, function (shipment) {
            var taxJurisdictionId = null;

            if (shipment.shippingAddress) {
                var location = new ShippingLocation(shipment.shippingAddress);
                taxJurisdictionId = TaxMgr.getTaxJurisdictionID(location);
            }

            if (!taxJurisdictionId) {
                taxJurisdictionId = TaxMgr.defaultTaxJurisdictionID;
            }

            if (!taxJurisdictionId) {
                return;
            }

            var lineItems = shipment.getAllLineItems();

            collections.forEach(lineItems, function (lineItem) {
                var taxClassId = lineItem.taxClassID;

                // Skip fixed tax rate items
                if (taxClassId === TaxMgr.customRateTaxClassID) {
                    return;
                }

                if (!taxClassId) {
                    taxClassId = TaxMgr.defaultTaxClassID;
                }

                if (!taxClassId) {
                    Logger.error('Line Item {0} has invalid Tax Class {1}', lineItem.lineItemText, lineItem.taxClassID);
                    return;
                }

                // get the tax rate
                var taxRate = TaxMgr.getTaxRate(taxClassId, taxJurisdictionId);
                // w/o a valid tax rate, we cannot calculate tax for the line item
                if (!taxRate && taxRate !== 0) {
                    return;
                }

                // calculate the tax of the line item
                taxes.push({ uuid: lineItem.UUID, value: taxRate, amount: false });
                Logger.debug('2. Line Item {0} with Tax Class {1} and Tax Rate {2}', lineItem.lineItemText, lineItem.taxClassID, lineItem.taxRate);
            });
        });
    }

    return { taxes: taxes, custom: {} };
}

module.exports = {
    calculateTaxes: calculateTaxes
};
