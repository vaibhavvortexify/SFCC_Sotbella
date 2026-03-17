'use strict';

var Status = require('dw/system/Status');
var Transaction = require('dw/system/Transaction');

/**
 * Ensures only one address is marked as default.
 * If the current address has c_isDefault = true, all other addresses will be set to false.
 *
 * @param {dw.customer.Customer} customer - The customer object.
 * @param {dw.customer.CustomerAddress} currentAddress - The current address being created or updated.
 * @returns {dw.system.Status} Status.OK
 */
function handleDefaultAddress(customer, currentAddress) {
    try {
        // If field is not sent or false, no action needed
        if (!('c_isDefault' in currentAddress) || currentAddress.c_isDefault !== true) {
            return new Status(Status.OK);
        }
        var addressBook = customer.getProfile().getAddressBook();
        var addresses = addressBook.getAddresses();
        Transaction.wrap(function () {
         for (var i = 0; i < addresses.length; i++) {
            var addr = addresses[i];
            if (addr.ID !== currentAddress.addressId && addr.custom.isDefault === true) {
                addr.custom.isDefault = false;
            }
        }   
        })

        return new Status(Status.OK);
    } catch (e) {
        return new Status(Status.ERROR, 'ERROR', 'Error updating default address: ' + e.message);
    }
}

/**
 * Called after a customer address is deleted.
 * @param {dw.customer.Customer} customer - The customer object.
 * @param {string} addressName - The ID/name of the deleted address.
 */
function handleRemoveAddress(customer, addressName) {
    try {
        var profile = customer.getProfile();
        if (!profile) {
            return new Status(Status.OK);
        }
        // Get all existing addresses
        var addresses = profile.getAddressBook().getAddresses();
        if (!addresses || addresses.length === 0) {
            return new Status(Status.OK);
        }
        // Check if the deleted address had c_isDefault = true
        var deletedAddress = profile.getAddressBook().getAddress(addressName);
        var wasDefault = deletedAddress && deletedAddress.custom && deletedAddress.custom.isDefault;
        if(wasDefault){
            // Find any other address to mark as default
            var newDefaultAddress = null;
            for(var i=0;i<addresses.length;i++){
                var current = addresses[i];
                if (current.ID !== addressName) {
                    newDefaultAddress = current;
                    break;
                }
            }
            if (newDefaultAddress) {
                Transaction.wrap(function () {
                    newDefaultAddress.custom.isDefault = true;
                });
            }
        }
        return new Status(Status.OK);
    }
    catch(e){
        return new Status(Status.ERROR);
    }
}

/**
 * Validates customer address fields.
 * @param {dw.customer.Customer} customer - The customer object
 * @param {dw.customer.CustomerAddress} customerAddress - The address object to validate.
 * @returns {dw.system.Status} - Returns ERROR if validation fails, else OK.
 */
function validateCustomerAddress(customer,customerAddress) {
    try {
        var requiredFields = ['address1', 'city', 'firstName', 'phone', 'postalCode', 'stateCode'];
        var missingFields = [];
        requiredFields.forEach(function (field) {
            if (!customerAddress[field] || String(customerAddress[field]).trim() === '') {
                missingFields.push(field);
            }
        });

        if (missingFields.length > 0) {
            var message = 'Missing required fields: ' + missingFields.join(', ');
            return new Status(Status.ERROR, 'ERROR_MISSING_FIELDS', message);
        }
        var profile = customer.getProfile();
        if (profile) {
            var addressBook = profile.getAddressBook();
            var addresses = addressBook.getAddresses();

            if (addresses.length === 0) {
                customerAddress.c_isDefault = true;
            } else if (customerAddress.c_isDefault == null) {
                // Ensure field is always defined
                customerAddress.c_isDefault = false;
            }
        }

        return new Status(Status.OK);
    } catch (error) {
        return new Status(Status.ERROR, 'VALIDATION_ERROR', 'Address validation failed.');
    }
}
module.exports = {
    handleDefaultAddress: handleDefaultAddress,
    handleRemoveAddress:handleRemoveAddress,
    validateCustomerAddress:validateCustomerAddress
};
