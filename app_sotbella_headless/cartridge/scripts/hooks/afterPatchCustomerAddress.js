'use strict';

var Status = require('dw/system/Status');
var AddressHelper = require('*/cartridge/scripts/helpers/CustomerAddressHelper');

exports.afterPATCH = function (customer, addressName, customerAddress) {
    return AddressHelper.handleDefaultAddress(customer, customerAddress);
};
