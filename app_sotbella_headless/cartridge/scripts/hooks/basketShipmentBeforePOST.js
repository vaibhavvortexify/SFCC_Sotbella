'use strict';

var Status = require('dw/system/Status');
var Site = require('dw/system/Site');

/**
 * Hook: dw.ocapi.shop.basket.shipment.beforePOST
 * Called before creating a shipment for a basket.
 */
exports.beforePOST = function (basket, shipment) {
	if (!Site.getCurrent().getCustomPreferenceValue('guestCheckout'))
		if (!request.session.customerAuthenticated)
			return new Status(
				Status.ERROR,
				'CUSTOMER_NOT_AUTHENTICATED',
				'Authentication is required before a shipment can be added to the basket.'
			);
	if (!shipment || !shipment.shippingAddress) {
		return new Status(Status.ERROR, 'ERROR', 'Shipping address is missing.');
	}

	var validationStatus = validateAddress(shipment.shippingAddress, 'shipping');

	if (validationStatus.status === Status.ERROR) {
		return validationStatus;
	}

	return new Status(Status.OK);
};

/**
 * Validates address fields.
 * @param {Object} address
 * @param {String} type
 */
function validateAddress(address, type) {
	var requiredFields = ['firstName', 'lastName', 'address1', 'city', 'postalCode', 'stateCode', 'countryCode'];

	for (var i = 0; i < requiredFields.length; i++) {
		var field = requiredFields[i];
		var value = address[field];
		if (!value || String(value).trim().length === 0) {
			return new Status(
				Status.ERROR,
				'ERROR',
				(type || 'Address') + ' ' + field + ' is required and cannot be empty.'
			);
		}
	}

	return new Status(Status.OK);
}
