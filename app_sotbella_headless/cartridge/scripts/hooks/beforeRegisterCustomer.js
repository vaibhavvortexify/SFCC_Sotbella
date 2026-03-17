'use strict';

var Status = require('dw/system/Status');
var RegisterCustomerHelper = require('*/cartridge/scripts/helpers/RegisterCustomerHelper');

exports.beforePOST = function (registration) {
	registration.customer.c_receiveOrderUpdates = true;
	registration.customer.c_newsletterSubscribed = true;
	return RegisterCustomerHelper.validateInfo(registration);
};
