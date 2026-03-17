'use strict';

/**
 * ShipmentDistributionHelper
 * Handles splitting basket shipments based on product categories and weight logic
 */

// SFCC API Imports
var Transaction = require('dw/system/Transaction');
var ShippingMgr = require('dw/order/ShippingMgr');
var UUIDUtils = require('dw/util/UUIDUtils');
// var HookMgr = require('dw/system/HookMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var Logger = require('dw/system/Logger').getLogger('IntlShipments', 'ShipmentDistributionHelper');

/**
 * forEach method for dw.util.Collection subclass instances
 * @param {dw.util.Collection} collection - Collection subclass instance to iterate
 * @param {Function} callback - Callback function for each item
 * @param {Object} [scope] - Optional scope for callback
 */
function forEach(collection, callback, scope) {
    if (!collection) return;
    var iterator = collection.iterator();
    var index = 0;
    while (iterator.hasNext()) {
        var item = iterator.next();
        if (scope) {
            callback.call(scope, item, index, collection);
        } else {
            callback(item, index, collection);
        }
        index++;
    }
}

/**
 * Copies the provided address details to the shipment shipping address.
 * @param {Object} address - The source address object
 * @param {dw.order.Shipment} shipment - The target shipment
 */
function copyCustomerAddressToShipment(address, shipment) {
    if (!address || !shipment) return;

    var shippingAddress = shipment.getShippingAddress();
    if (!shippingAddress) {
        shippingAddress = shipment.createShippingAddress();
    }

    shippingAddress.setFirstName(address.firstName);
    shippingAddress.setLastName(address.lastName);
    shippingAddress.setAddress1(address.address1);
    shippingAddress.setAddress2(address.address2);
    shippingAddress.setCity(address.city);
    shippingAddress.setPostalCode(address.postalCode);
    shippingAddress.setStateCode(address.stateCode);
    shippingAddress.setCountryCode(address.countryCode.value);
    shippingAddress.setPhone(address.phone);
}

/**
 * Creates a new shipment in the basket with a given shipping method and address.
 * @param {dw.order.Basket} basket - The basket instance
 * @param {string} shippingMethodID - The ID of the shipping method to apply
 * @param {dw.order.OrderAddress} baseAddress - Address to copy into new shipment
 * @returns {dw.order.Shipment} The newly created shipment
 */
function createShipmentForMethod(basket, shippingMethodID, baseAddress) {
    var shipment = basket.createShipment(UUIDUtils.createUUID());
    var shippingMethod = ShippingMgr.getAllShippingMethods().toArray().find(function (m) {
        return m.ID === shippingMethodID;
    });

    if (shippingMethod) {
        shipment.setShippingMethod(shippingMethod);
    } else {
        Logger.warn('Shipping method with ID "{0}" not found.', shippingMethodID);
    }

    if (baseAddress) {
        copyCustomerAddressToShipment(baseAddress, shipment);
    }

    return shipment;
}

/**
 * Main function to organize basket shipments based on international shipping category
 * @param {dw.order.Basket} basket - Current basket object
 */
function organizeShipments(basket) {
    if (!basket || basket.getAllProductLineItems().isEmpty()) {
        Logger.warn('Basket is null or empty, skipping ShipmentDistributionHelper.');
        return;
    }

    try {
        Transaction.wrap(function () {
            Logger.info('--- Shipment Distribution Helper: Start for Basket {0} ---', basket.UUID);

            // Step 1: Reset non-default shipments
            var defaultShipment = basket.getDefaultShipment();
            var baseAddress = defaultShipment.getShippingAddress();

            var defaultShippingMethod = ShippingMgr.getAllShippingMethods().toArray().find(function (m) {
                return m.ID === 'SHIPPING2000'; 
            });

            if (defaultShippingMethod) {
                defaultShipment.setShippingMethod(defaultShippingMethod);
                Logger.info('Default shipment assigned with shipping method: {0}', defaultShippingMethod.ID);
            } else {
                Logger.warn('Default shipping method not found: SHIPPING2000');
            }

            var shipmentsToRemove = [];
            forEach(basket.getShipments(), function (shipment) {
                if (!shipment.isDefault()) {
                    forEach(shipment.getProductLineItems(), function (pli) {
                        pli.setShipment(defaultShipment);
                    });
                    shipmentsToRemove.push(shipment);
                }
            });

            shipmentsToRemove.forEach(function (shipment) {
                basket.removeShipment(shipment);
            });

            // Step 2: Categorize items
            var items2000 = [];
            var items1000 = [];
            var items500 = [];

            forEach(basket.getAllProductLineItems(), function (pli) {
                var product = ProductMgr.getProduct(pli.getProductID());
                if (!product) return;

                var category = product.custom.internationalShippingCategory || 'SHIPPING2000';
                switch (category) {
                    case 'SHIPPING1000':
                        items1000.push(pli);
                        break;
                    case 'SHIPPING500':
                        items500.push(pli);
                        break;
                    default:
                        items2000.push(pli);
                        break;
                }
            });

            // Step 3: Packing Logic
            while (items2000.length > 0) {
                var shipment2000 = createShipmentForMethod(basket, 'SHIPPING2000', baseAddress);
                items2000.pop().setShipment(shipment2000);
                if (items2000.length > 0) {
                    items2000.pop().setShipment(shipment2000);
                }
            }

            while (items1000.length >= 2) {
                var shipment2kg_a = createShipmentForMethod(basket, 'SHIPPING2000', baseAddress);
                items1000.pop().setShipment(shipment2kg_a);
                items1000.pop().setShipment(shipment2kg_a);
            }

            while (items500.length >= 4) {
                var shipment2kg_b = createShipmentForMethod(basket, 'SHIPPING2000', baseAddress);
                for (var i = 0; i < 4; i++) {
                    items500.pop().setShipment(shipment2kg_b);
                }
            }

            if (items1000.length >= 1 && items500.length >= 2) {
                var shipment2kg_c = createShipmentForMethod(basket, 'SHIPPING2000', baseAddress);
                items1000.pop().setShipment(shipment2kg_c);
                items500.pop().setShipment(shipment2kg_c);
                items500.pop().setShipment(shipment2kg_c);
            }

            while (items1000.length >= 1) {
                var shipment1kg_a = createShipmentForMethod(basket, 'SHIPPING1000', baseAddress);
                items1000.pop().setShipment(shipment1kg_a);
            }

            while (items500.length >= 2) {
                var shipment1kg_b = createShipmentForMethod(basket, 'SHIPPING1000', baseAddress);
                items500.pop().setShipment(shipment1kg_b);
                items500.pop().setShipment(shipment1kg_b);
            }

            while (items500.length > 0) {
                var shipment500g = createShipmentForMethod(basket, 'SHIPPING500', baseAddress);
                items500.pop().setShipment(shipment500g);
            }

            // // Step 4: Recalculate totals (shipping cost, taxes, etc.)
            // HookMgr.callHook('dw.order.calculate', 'calculate', basket);

            Logger.info('--- Shipment Distribution Helper: Completed Successfully ---');
        });
    } catch (e) {
        Logger.error('Error in ShipmentDistributionHelper: {0}\n{1}', e.message, e.stack);
        throw e;
    }
}

module.exports = {
    organizeShipments: organizeShipments
};
