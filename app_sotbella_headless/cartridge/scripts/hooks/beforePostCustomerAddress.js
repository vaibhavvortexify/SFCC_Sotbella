'use strict';

var Status = require('dw/system/Status');
var AddressHelper = require('*/cartridge/scripts/helpers/CustomerAddressHelper');

exports.beforePOST = function (customer, addressName, customerAddress) {
    return AddressHelper.validateCustomerAddress(customer,customerAddress);
};
