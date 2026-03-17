'use strict';

var Status = require('dw/system/Status');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

exports.beforePUT = function (basket, shipment) {
	try {
		if (!Site.getCurrent().getCustomPreferenceValue('guestCheckout'))
			if (!request.session.customerAuthenticated)
				return new Status(
					Status.ERROR,
					'CUSTOMER_NOT_AUTHENTICATED',
					'Authentication is required before a shipment can be added to the basket.'
				);

		return new Status(Status.OK);
	} catch (e) {
		Logger.error('Full stack trace: {0}', e.stack);
		Logger.error('Error Message: {0}', e.message);
		return new Status(Status.ERROR, 'ERROR', e.message);
	}
};
