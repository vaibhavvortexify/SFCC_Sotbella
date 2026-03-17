'use strict';

var Status = require('dw/system/Status');
var AddressHelper = require('*/cartridge/scripts/helpers/CustomerAddressHelper');

exports.beforeDELETE = function (customer, addressName) {
    return AddressHelper.handleRemoveAddress(customer, addressName);
};
