'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var FtpClientHelper = require('*/cartridge/services/FtpClientHelper');

module.exports.getFTPService = function (serviceID) {
    var ftpService = LocalServiceRegistry.createService(serviceID, {
        createRequest: function (service) {
            // This fix ensures 'putBinary', 'cd', etc. are recognized as operations
            var args = Array.prototype.slice.call(arguments, 1);
            service.setOperation.apply(service, args);
            return service;
        },
        parseResponse: function (service, result) {
            return result;
        }
    });

    return new FtpClientHelper(ftpService);
};